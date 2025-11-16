const router = require('express').Router();
const multer = require('multer');
const path = require('path');

// Diretório onde as imagens serão salvas
const uploadDir = path.join(__dirname, '..', 'upload', 'images');

// Configuração do armazenamento
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({ storage });

router.post('/upload-multiple', upload.array('product_images'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: 0, error: 'Nenhuma imagem recebida' });
  }

  const { BASE_URL } = require('../config');
  const urls = req.files.map(file => `${BASE_URL}/images/${file.filename}`);

  console.log('✅ Imagens salvas:', urls);

  res.json({ success: 1, image_urls: urls });
});

module.exports = router;