const express = require('express');
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

const JWT_SECRET = process.env.JWT_SECRET || 'secret_ecom';
const { BASE_URL } = require('../config');
const { BASE_URL, DEFAULT_IMAGE } = require('../config');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

// 🔧 Função para normalizar URLs de imagem
const normalizeImageURL = (imageUrl) => {
  if (!imageUrl) return DEFAULT_IMAGE;
  
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  
  if (imageUrl.startsWith('/images/') || imageUrl.startsWith('images/')) {
    return `${BASE_URL}/${imageUrl.replace(/^\//, '')}`;
  }
  
  return DEFAULT_IMAGE;
};

// Configuração multer para upload de imagem
const storage = multer.diskStorage({
  destination: './upload/images',
  filename: (req, file, cb) => {
    cb(null, `profile_${Date.now()}${path.extname(file.originalname)}`);
  }
});

const uploadProfile = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
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

// ✅ SIGNUP: Criptografa a senha e salva na pendência
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
    
    // 🔒 CRIPTOGRAFA A SENHA COM BCRYPT
    const hashedPassword = await bcrypt.hash(password, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const normalizedImage = image ? normalizeImageURL(image) : DEFAULT_IMAGE;

    let pending = await PendingUsers.findOne({ email: emailNorm });
    if (pending) {
      pending.code = code;
      pending.password = hashedPassword; // ✅ Salva o hash
      pending.name = username;
      pending.image = normalizedImage;
      pending.expiresAt = expiresAt;
      await pending.save();
    } else {
      pending = new PendingUsers({
        name: username,
        email: emailNorm,
        password: hashedPassword, // ✅ Salva o hash
        image: normalizedImage,
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
      `
    };

    await transporter.sendMail(mailOptions).catch(err => {
      console.error('❌ Erro ao enviar email:', err);
    });

    res.json({ success: true, message: 'Código de verificação enviado por email' });
  } catch (err) {
    console.error('❌ Erro signup:', err);
    res.status(500).json({ success: false, errors: 'Erro interno', details: err.message });
  }
});

// ✅ CONFIRM: Transfere o hash da pendência para o usuário final
router.post('/confirm', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'email e code obrigatórios' });
    }

    const emailNorm = String(email).toLowerCase().trim();
    const pending = await PendingUsers.findOne({ email: emailNorm, code });

    if (!pending) {
      return res.status(404).json({ success: false, error: 'Código inválido' });
    }

    if (pending.expiresAt && pending.expiresAt < new Date()) {
      await PendingUsers.findByIdAndDelete(pending._id);
      return res.status(400).json({ success: false, error: 'Código expirado' });
    }

    // ✅ Cria o usuário com o hash já criptografado
    const user = new Users({
      name: pending.name,
      email: pending.email,
      password: pending.password, // ✅ Já está criptografado
      image: normalizeImageURL(pending.image),
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
        image: normalizeImageURL(user.image)
      }
    });
  } catch (err) {
    console.error('❌ Erro confirm:', err);
    res.status(500).json({ success: false, error: 'Erro interno', details: err.message });
  }
});

// ✅ LOGIN: Compara a senha em texto com o hash armazenado
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
    console.log('🔒 Hash no DB (primeiros 30 chars):', user.password.substring(0, 30) + '...');
    console.log('🔒 Hash começa com $2b$ (bcrypt)?', user.password.startsWith('$2b$'));
    console.log('🔒 Tamanho do hash:', user.password.length);

    // 🔐 COMPARA A SENHA EM TEXTO COM O HASH
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    
    console.log('🔐 bcrypt.compare resultado:', isPasswordCorrect);
    console.log('=================================\n');

    if (!isPasswordCorrect) {
      return res.json({ success: false, errors: 'Senha incorreta' });
    }

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
        image: normalizeImageURL(user.image)
      }
    });
  } catch (err) {
    console.error('❌ Erro login:', err);
    res.status(500).json({ success: false, errors: 'Erro interno' });
  }
});

router.post('/getuser', fetchUser, async (req, res) => {
  try {
    const user = await Users.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, errors: 'Usuário não encontrado' });
    }

    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        image: normalizeImageURL(user.image),
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
  if (!userData) return res.status(404).json({ success: false, error: "Usuário não encontrado" });
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
  if (!userData) return res.status(404).json({ success: false, error: "Usuário não encontrado" });
  if (userData.cartData[key]?.qty > 1) userData.cartData[key].qty -= 1;
  else delete userData.cartData[key];
  await Users.findByIdAndUpdate(req.user.id, { cartData: userData.cartData });
  res.json({ success: true, message: 'Removido' });
});

router.post('/getcart', fetchUser, async (req, res) => {
  try {
    const userData = await Users.findById(req.user.id);
    
    if (!userData) {
      return res.status(404).json({ success: false, error: "Usuário não encontrado" });
    }
    
    res.json(userData.cartData || {});
  } catch (err) {
    console.error("❌ Erro ao buscar carrinho:", err);
    res.status(500).json({ success: false, error: "Erro interno ao buscar carrinho" });
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
        image: produto.images?.[0] || '' 
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
    console.error("❌ Erro ao finalizar compra:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/historico', fetchUser, async (req, res) => {
  try {
    const user = await Users.findById(req.user.id);
    if (!user || !user.historico) return res.json([]);
    res.json(user.historico);
  } catch (err) {
    console.error("❌ Erro ao buscar histórico:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar histórico" });
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

// Rota para atualizar usuário
router.put('/updateuser', fetchUser, uploadProfile.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, password } = req.body;

    const updateData = {};
    
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Senha deve ter no mínimo 6 caracteres' });
      }
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    if (req.file) {
  const { BASE_URL } = require('../config');
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

    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso',
      user: updatedUser
    });
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ success: false, error: 'Erro ao atualizar perfil' });
  }
});

module.exports = router;