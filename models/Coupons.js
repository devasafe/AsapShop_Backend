const mongoose = require('mongoose');

const CouponSchema = new mongoose.Schema({
  codigo: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true,
    trim: true
  },
  tipo: { 
    type: String, 
    required: true,
    enum: ['percentual', 'fixo'], // ✅ Valores aceitos
    lowercase: true // ✅ Converte automaticamente para minúsculo
  },
  valor: { 
    type: Number, 
    required: true,
    min: 0
  },
  ativo: { 
    type: Boolean, 
    default: true 
  },
  criadoEm: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // ✅ Adiciona createdAt e updatedAt automaticamente
});

module.exports = mongoose.model('Coupon', CouponSchema);