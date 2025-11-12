const express = require('express');
const Users = require('../models/Users');
const fetchUser = require('../middlewares/fetchUsers');
const router = require('express').Router();
const PendingUsers = require('../models/PendingUsers');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Product = require('../models/Product');
const { MercadoPagoConfig } = require('mercadopago');


router.post('/addproduct', async (req, res) => {
  try {
    const last = await Product.findOne().sort({ id: -1 }).limit(1);
    const id = last ? last.id + 1 : 1;
    const product = new Product({
      id,
      name: req.body.name,
      images: req.body.images || [],
      category: req.body.category || 'outros',
      new_price: req.body.new_price || 0,
      old_price: req.body.old_price || 0,
      drop_id: req.body.drop_id || String(Date.now()),
      drop_start: req.body.drop_start || new Date(),
      drop_end: req.body.drop_end || new Date(),
      available: req.body.available ?? true,
      sizes: req.body.sizes || [],
      colors: req.body.colors || [],
      stock: req.body.stock ?? 0,
      description: req.body.description || ''
    });
    await product.save();
    res.json({ success: true, name: product.name });
  } catch (err) {
    console.error('Erro addproduct:', err);
    res.status(500).json({ success: false, error: 'Erro ao adicionar produto' });
  }
});

router.post('/updateproduct', async (req, res) => {
  try {
    const { id, name, new_price, stock } = req.body;
    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (new_price !== undefined) updateFields.new_price = new_price;
    if (stock !== undefined) updateFields.stock = stock;
    await Product.findOneAndUpdate({ id }, { $set: updateFields });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/removeproduct', async (req, res) => {
  try {
    await Product.findOneAndDelete({ id: req.body.id });
    res.json({ success: true, name: req.body.name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adicione esta rota antes de buscar produtos
router.get('/allproducts', async (req, res) => {
  try {
    // Atualiza drops expirados automaticamente
    const agora = new Date();
    await Product.updateMany(
      { 
        drop_end: { $lt: agora },
        available: true 
      },
      { 
        $set: { available: false } 
      }
    );

    const products = await Product.find({});
    res.json(products);
  } catch (err) {
    console.error('Erro ao buscar produtos:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/toggleDropAvailable', async (req, res) => {
  try {
    const { drop_id, available } = req.body;
    await Product.updateMany({ drop_id }, { available });
    if (!available) await Product.updateMany({ drop_id }, { stock: 0 });
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao atualizar drop:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/updatedropdates', async (req, res) => {
  try {
    const { drop_id, drop_start, drop_end } = req.body;
    await Product.updateMany({ drop_id }, { drop_start, drop_end });
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao atualizar datas do drop:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/toggleavailable', async (req, res) => {
  try {
    const { id, available } = req.body;
    await Product.findOneAndUpdate({ id }, { available });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
