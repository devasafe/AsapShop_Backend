const express = require('express');
const router = express.Router();
const Coupons = require('../models/Coupons');

// ✅ Adicionar novo cupom
router.post('/addcoupon', async (req, res) => {
  let { codigo, tipo, valor } = req.body;
  
  if (!codigo || !tipo || valor == null) {
    return res.status(400).json({ success: false, error: 'Campos obrigatórios ausentes' });
  }
  
  // 🔧 NORMALIZA O TIPO PARA EVITAR ERROS
  if (tipo === 'porcentagem') tipo = 'percentual';
  if (tipo === 'valor fixo' || tipo === 'valorFixo') tipo = 'fixo';
  
  // ✅ VALIDA SE O TIPO É VÁLIDO
  if (!['percentual', 'fixo'].includes(tipo)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Tipo inválido. Use "percentual" ou "fixo"' 
    });
  }
  
  try {
    const existing = await Coupons.findOne({ codigo: codigo.toUpperCase() });
    
    if (existing) {
      return res.json({ success: false, error: 'Cupom já existe' });
    }
    
    const newCoupon = new Coupons({ 
      codigo: codigo.toUpperCase(), 
      tipo, 
      valor, 
      ativo: true 
    });
    
    await newCoupon.save();
    
    res.json({ success: true, cupom: newCoupon });
  } catch (err) {
    console.error('❌ Erro ao adicionar cupom:', err);
    res.status(500).json({ success: false, error: 'Erro ao adicionar cupom' });
  }
});

// ✅ Buscar todos os cupons
router.get('/allcoupons', async (req, res) => {
  try {
    const coupons = await Coupons.find().sort({ _id: -1 });
    res.json({ success: true, coupons });
  } catch (err) {
    console.error('❌ Erro ao buscar cupons:', err);
    res.status(500).json({ success: false, error: 'Erro ao buscar cupons' });
  }
});

// ✅ Validar cupom no checkout
router.post('/validarcupom', async (req, res) => {
  const { codigo } = req.body;
  
  if (!codigo) {
    return res.status(400).json({ success: false, error: 'Código não fornecido' });
  }
  
  try {
    const cupom = await Coupons.findOne({ 
      codigo: codigo.toUpperCase(), 
      ativo: true 
    });
    
    if (!cupom) {
      return res.json({ success: false, error: 'Cupom inválido ou inativo' });
    }
    
    res.json({ 
      success: true, 
      cupom: {
        codigo: cupom.codigo,
        tipo: cupom.tipo,
        valor: cupom.valor
      }
    });
  } catch (err) {
    console.error('❌ Erro ao validar cupom:', err);
    res.status(500).json({ success: false, error: 'Erro ao validar cupom' });
  }
});

// ✅ Alterar status do cupom (ativo/inativo)
router.patch('/cupomstatus/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ativo } = req.body;
    
    const cupom = await Coupons.findByIdAndUpdate(
      id, 
      { ativo }, 
      { new: true }
    );
    
    if (!cupom) {
      return res.status(404).json({ success: false, error: 'Cupom não encontrado' });
    }
    
    res.json({ success: true, cupom });
  } catch (err) {
    console.error('❌ Erro ao atualizar status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Remover cupom
router.delete('/removercupom/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const cupom = await Coupons.findByIdAndDelete(id);
    
    if (!cupom) {
      return res.status(404).json({ success: false, error: 'Cupom não encontrado' });
    }
    
    res.json({ success: true, message: 'Cupom removido com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao remover cupom:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;