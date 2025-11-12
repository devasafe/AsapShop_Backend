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


router.post('/send-email', async (req, res) => {
  const { nome, email, assunto, mensagem } = req.body;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"${nome}" <${email}>`,
      to: 'contatoasapdev@gmail.com',
      subject: `Contato via site - ${assunto}`,
      text: mensagem
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

module.exports = router;