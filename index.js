require('dotenv').config();
const port = process.env.PORT || 4000;

const express = require('express');
const app = express();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');



// Conexão com MongoDB
const mongoUri =
  process.env.MONGO_URI ||
  'mongodb+srv://asapdev:Sam.samela321%40@cluster0.cskla.mongodb.net/loja';

mongoose
  .connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB conectado'))
  .catch((err) => console.error('❌ Erro MongoDB:', err));

// Confiança de proxy (evita req.protocol virar https em dev)
app.set('trust proxy', false);

// MIDDLEWARES (devem vir ANTES das rotas)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(
  cors({
    origin: [
      FRONTEND_URL,
      'http://localhost:3000',
      'https://asap-shop-frontend.vercel.app'
    ],
    credentials: true,
  })
);

// Servir imagens estáticas
const uploadDir = path.join(__dirname, 'upload', 'images');
app.use('/images', express.static(uploadDir));

// IMPORTAR ROTAS
const usersRouter = require('./routes/user'); // ✅ TIRAR O 'S'
const productsRouter = require('./routes/products');
const couponsRouter = require('./routes/coupons');
const uploadRouter = require('./routes/upload');
const emailRouter = require('./routes/email');
const pagamentoRouter = require('./routes/pagamento');
const pixRouter = require('./routes/pix');

// MONTAR ROTAS
app.use('/users', usersRouter);
app.use('/products', productsRouter);
app.use('/coupons', couponsRouter);
app.use('/upload', uploadRouter);
app.use('/email', emailRouter);
app.use('/pagamento', pagamentoRouter);
app.use('/pix', pixRouter);


// Alias para /pagar-pix -> /pix/pagar-pix (mantém método com 307)
app.all('/pagar-pix', (req, res) => res.redirect(307, '/pix/pagar-pix'));

// Healthcheck simples
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Rota raiz
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Express App está funcionando',
    routes: [
      '/users',
      '/products',
      '/coupons',
      '/upload',
      '/email',
      '/pagamento',
      '/pix',
      '/images',
    ],
  });
});

// Tratamento de rotas não encontradas
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Rota ${req.method} ${req.path} não encontrada`,
  });
});

// Tratamento de erros globais
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Erro interno do servidor',
  });
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`✅ Backend no ar`);
  console.log(`📁 Imagens em: ${uploadDir}`);
});

module.exports = app;