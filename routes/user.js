const { BASE_URL } = require('../config');
const Users = require('../models/Users');
const fetchUser = require('../middlewares/fetchUsers');
const router = require('express').Router();
const PendingUsers = require('../models/PendingUsers');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Product = require('../models/Product');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'secret_ecom';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

// SIGNUP: cria pendência, envia código e já guarda senha hasheada na pendência
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, image } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, errors: 'Campos obrigatórios ausentes' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, errors: 'Formato de email inválido' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, errors: 'Senha deve ter no mínimo 6 caracteres' });
    }

    const emailNorm = String(email).toLowerCase().trim();
    const existingUser = await Users.findOne({ email: emailNorm });
    if (existingUser) {
      return res.status(400).json({ success: false, errors: 'Já existe um usuário com este email' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const hashed = await bcrypt.hash(password, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    let pending = await PendingUsers.findOne({ email: emailNorm });
    if (pending) {
      pending.code = code;
      pending.password = hashed;
      pending.name = username;
      pending.image = image || pending.image;
      pending.expiresAt = expiresAt;
      pending.email = emailNorm;
      await pending.save();
    } else {
      pending = new PendingUsers({
        name: username,
        email: emailNorm,
        password: hashed,
  image: image || `${BASE_URL}/images/default.png`,
        code,
        expiresAt
      });
      await pending.save();
    }

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: emailNorm,
      subject: 'Confirmação de cadastro - código de verificação',
      html: `
        <h2>Bem-vindo à AsapShop!</h2>
        <p>Olá <strong>${username}</strong>,</p>
        <p>Seu código de verificação é:</p>
        <h1 style="color: #d4af37; font-size: 36px; letter-spacing: 5px;">${code}</h1>
        <p>Este código expira em 1 hora.</p>
        <p>Se você não solicitou este cadastro, ignore este email.</p>
      `
    };

    await transporter.sendMail(mailOptions).catch(err => {
      console.error('❌ Erro ao enviar email:', err);
    });

    res.json({ success: true, message: 'Código de verificação enviado por email' });
  } catch (err) {
    console.error('❌ Erro signup:', err);
    res.status(500).json({ success: false, errors: 'Erro interno ao registrar usuário', details: err.message });
  }
});

// CONFIRM: cria o usuário definitivo com o hash já salvo na pendência
router.post('/confirm', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'email e code obrigatórios' });
    }

    const emailNorm = String(email).toLowerCase().trim();
    const pending = await PendingUsers.findOne({ email: emailNorm, code });

    if (!pending) {
      return res.status(404).json({ success: false, error: 'Código inválido ou usuário não encontrado' });
    }

    if (pending.expiresAt && pending.expiresAt < new Date()) {
      await PendingUsers.findByIdAndDelete(pending._id);
      return res.status(400).json({ success: false, error: 'Código expirado' });
    }

    const user = new Users({
      name: pending.name,
      email: pending.email,
      password: pending.password,
      image: pending.image || `${BASE_URL}/images/default.png`,
      cartData: {},
      isAdmin: false
    });

    await user.save();
    await PendingUsers.findByIdAndDelete(pending._id);

    const token = jwt.sign(
      { user: { id: user._id.toString(), isAdmin: user.isAdmin } },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        image: user.image
      }
    });
  } catch (err) {
    console.error('❌ Erro confirm:', err);
    res.status(500).json({ success: false, error: 'Erro interno', details: err.message });
  }
});

// LOGIN: compara senha em texto com hash armazenado
router.post('/login', async (req, res) => {
  try {
    const emailNorm = String(req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';

    console.log('\n========== LOGIN DEBUG ==========');
    console.log('📧 Email:', emailNorm);
    console.log('🔑 Senha recebida (length):', password.length);

    const user = await Users.findOne({ email: emailNorm });
    
    if (!user) {
      console.log('❌ Usuário não encontrado');
      return res.json({ success: false, errors: 'Email incorreto' });
    }

    console.log('✅ Usuário encontrado:', user.email);
    console.log('🔒 Hash no DB:', user.password.substring(0, 20) + '...');
    console.log('🔒 Hash válido?', user.password.startsWith('$2b$'));

    const passCompare = await bcrypt.compare(password, user.password);
    console.log('🔐 bcrypt.compare resultado:', passCompare);
    console.log('=================================\n');

    if (!passCompare) {
      return res.json({ success: false, errors: 'Senha incorreta' });
    }

    const token = jwt.sign(
      { user: { id: user.id, isAdmin: user.isAdmin } },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
  image: user.image || `${BASE_URL}/images/default.png`
      }
    });
  } catch (err) {
    console.error('❌ Erro login:', err);
    res.status(500).json({ success: false, errors: 'Erro interno no login' });
  }
});

router.post('/getuser', fetchUser, async (req, res) => {
  try {
    const user = await Users.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, errors: 'Usuário não encontrado' });

    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        image: user.image || `${BASE_URL}/images/default.png`,
        cartData: user.cartData,
        compras: user.compras || [],
        historico: user.historico || [],
        date: user.date
      }
    });
  } catch (err) {
    console.error('❌ Erro getuser:', err);
    res.status(500).json({ success: false, errors: 'Erro ao buscar usuário' });
  }
});

router.post('/addtocart', fetchUser, async (req, res) => {
  const { itemId, size = 'Único', color = 'Padrão' } = req.body;
  const key = `${itemId}_${size}_${color}`;
  let userData = await Users.findById(req.user.id);
  if (!userData) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
  if (!userData.cartData || typeof userData.cartData !== 'object') userData.cartData = {};
  if (!userData.cartData[key]) userData.cartData[key] = { qty: 1, size, color, id: itemId };
  else userData.cartData[key].qty += 1;
  await Users.findByIdAndUpdate(req.user.id, { cartData: userData.cartData });
  res.json({ success: true, message: 'Adicionado com sucesso' });
});

router.post('/removefromcart', fetchUser, async (req, res) => {
  const { itemId, size = 'Único', color = 'Padrão' } = req.body;
  const key = `${itemId}_${size}_${color}`;
  let userData = await Users.findById(req.user.id);
  if (!userData) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
  if (userData.cartData[key]?.qty > 1) userData.cartData[key].qty -= 1;
  else delete userData.cartData[key];
  await Users.findByIdAndUpdate(req.user.id, { cartData: userData.cartData });
  res.json({ success: true, message: 'Removido' });
});

router.post('/getcart', fetchUser, async (req, res) => {
  try {
    const userData = await Users.findById(req.user.id);
    if (!userData) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    res.json(userData.cartData || {});
  } catch (err) {
    console.error('❌ Erro ao buscar carrinho:', err);
    res.status(500).json({ success: false, error: 'Erro interno ao buscar carrinho' });
  }
});

router.post('/finalizarcompra', fetchUser, async (req, res) => {
  const { itens, endereco } = req.body;
  const userId = req.user.id;
  if (!itens || !Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ success: false, error: 'Itens inválidos ou ausentes.' });
  }
  try {
    const itensCompletos = [];
    let total = 0;
    const erros = [];

    for (const item of itens) {
      const produto = await Product.findOne({ id: item.id });
      if (!produto) {
        erros.push(`Produto com ID ${item.id} não encontrado`);
        continue;
      }
      if (item.qty > produto.stock) {
        erros.push(`Estoque insuficiente para "${produto.name}"`);
        continue;
      }
      await Product.updateOne({ id: item.id }, { $inc: { stock: -item.qty } });
      total += produto.new_price * item.qty;
      itensCompletos.push({
        id: item.id,
        qty: item.qty,
        size: item.size,
        color: item.color,
        name: produto.name,
        image: (produto.images?.[0] || '')
      });
    }

    if (erros.length > 0) {
      return res.status(400).json({ success: false, error: erros.join('\n') });
    }

    await Users.updateOne(
      { _id: userId },
      { $push: { historico: { itens: itensCompletos, endereco, total, status: 'Pendente', data: new Date() } } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erro ao finalizar compra:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/historico', fetchUser, async (req, res) => {
  try {
    const user = await Users.findById(req.user.id);
    if (!user || !user.historico) return res.json([]);
    res.json(user.historico);
  } catch (err) {
    console.error('❌ Erro ao buscar histórico:', err);
    res.status(500).json({ success: false, error: 'Erro ao buscar histórico' });
  }
});

router.get('/getallpedidos', async (req, res) => {
  try {
    const usuarios = await Users.find();
    const todosPedidos = usuarios.flatMap(user =>
      (user.historico || []).map(pedido => ({
        _id: pedido._id,
        idUsuario: user._id,
        nome: user.name,
        email: user.email,
        total: pedido.total,
        status: pedido.status,
        data: pedido.data,
        endereco: pedido.endereco,
        itens: (pedido.itens || []).map(item => ({
          id: item.id,
          qty: item.qty,
          size: item.size,
          color: item.color,
          name: item.name,
          image: item.image || ''
        }))
      }))
    );
    res.json({ success: true, pedidos: todosPedidos });
  } catch (err) {
    console.error('❌ Erro ao buscar pedidos:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar pedidos' });
  }
});

router.patch('/updatepedido/:id', async (req, res) => {
  const pedidoId = req.params.id;
  const { status } = req.body;
  try {
    const usuario = await Users.findOne({ 'historico._id': pedidoId });
    if (!usuario) return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    const pedido = usuario.historico.id(pedidoId);
    if (!pedido) return res.status(404).json({ success: false, message: 'Pedido inválido' });
    pedido.status = status;
    await usuario.save();
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erro ao atualizar pedido:', err);
    res.status(500).json({ success: false, message: 'Erro interno ao atualizar pedido' });
  }
});

// Configuração multer para upload de imagem de perfil
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './upload/images';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `profile_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const uploadProfile = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Apenas imagens são permitidas!'));
  }
});

// NOVA ROTA: Atualizar perfil do usuário
router.put('/updateuser', fetchUser, uploadProfile.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, password } = req.body;

    console.log('📝 Atualizando usuário:', { userId, name, email, hasPassword: !!password, hasImage: !!req.file });

    const updateData = {};
    
    if (name && name.trim()) {
      updateData.name = name.trim();
    }
    
    if (email && email.trim()) {
      const emailNorm = email.toLowerCase().trim();
      const emailExists = await Users.findOne({ email: emailNorm, _id: { $ne: userId } });
      if (emailExists) {
        return res.status(400).json({ success: false, error: 'Email já está em uso' });
      }
      updateData.email = emailNorm;
    }
    
    if (password && password.trim()) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Senha deve ter no mínimo 6 caracteres' });
      }
      const hashed = await bcrypt.hash(password, 10);
      updateData.password = hashed;
    }

    if (req.file) {
  updateData.image = `${BASE_URL}/images/${req.file.filename}`;
    }

    const updatedUser = await Users.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    console.log('✅ Usuário atualizado:', updatedUser.email);

    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso',
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        image: updatedUser.image || `${BASE_URL}/images/default.png`,
        cartData: updatedUser.cartData,
        compras: updatedUser.compras || [],
        historico: updatedUser.historico || [],
        date: updatedUser.date
      }
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar usuário:', error);
    res.status(500).json({ success: false, error: error.message || 'Erro ao atualizar perfil' });
  }
});

// ✅ ROTA ADMIN: Listar todos os usuários com histórico
router.get('/getall', fetchUser, async (req, res) => {
  try {
    console.log('📋 Admin solicitando lista de usuários...');
    
    const adminUser = await Users.findById(req.user.id);
    
    if (!adminUser || !adminUser.isAdmin) {
      console.log('❌ Usuário não é admin:', req.user.id);
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas admins.' });
    }

    const users = await Users.find().select('-password');
    console.log(`✅ Retornando ${users.length} usuários`);
    
    res.json({ success: true, users });
  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ ROTA ADMIN: Apagar histórico de compras de um usuário
router.delete('/admin/clear-historico/:userId', fetchUser, async (req, res) => {
  try {
    const adminUser = await Users.findById(req.user.id);
    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas admins.' });
    }

    const { userId } = req.params;

    const user = await Users.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    user.historico = [];
    await user.save();

    console.log(`✅ Histórico do usuário ${user.email} apagado pelo admin ${adminUser.email}`);

    res.json({
      success: true,
      message: `Histórico de ${user.name} apagado com sucesso`
    });
  } catch (error) {
    console.error('❌ Erro ao apagar histórico:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ ROTA ADMIN: Apagar um pedido específico do histórico
router.delete('/admin/delete-pedido/:userId/:pedidoId', fetchUser, async (req, res) => {
  try {
    const adminUser = await Users.findById(req.user.id);
    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ success: false, error: 'Acesso negado. Apenas admins.' });
    }

    const { userId, pedidoId } = req.params;

    const user = await Users.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const pedidoIndex = user.historico.findIndex(p => p._id.toString() === pedidoId);
    if (pedidoIndex === -1) {
      return res.status(404).json({ success: false, error: 'Pedido não encontrado' });
    }

    user.historico.splice(pedidoIndex, 1);
    await user.save();

    console.log(`✅ Pedido ${pedidoId} removido do histórico de ${user.email} pelo admin ${adminUser.email}`);

    res.json({
      success: true,
      message: 'Pedido removido com sucesso'
    });
  } catch (error) {
    console.error('❌ Erro ao apagar pedido:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;