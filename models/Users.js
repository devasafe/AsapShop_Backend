const mongoose = require('mongoose');



const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true, trim: true },
  // Armazena o HASH da senha
  password: { type: String, required: true },
  image: String,
  cartData: Object,
  compras: [
    {
      id: String,
      name: String,
      price: Number,
      images: String,
      drop: {
        id: String,
        name: String
      }
    }
  ],
  historico: [
    {
      itens: [
        {
          id: Number,
          qty: Number,
          size: String,
          color: String,
          name: String,
          image: String
        }
      ],
      endereco: {
        nome: String,
        cpf: String,
        rua: String,
        numero: String,
        complemento: String,
        cidade: String,
        estado: String,
        cep: String
      },
      total: Number,
      status: { type: String, default: 'Pendente' },
      data: { type: Date, default: Date.now }
    }
  ],
  date: { type: Date, default: Date.now },
  isAdmin: { type: Boolean, default: false }
});

module.exports = mongoose.model('Users', UserSchema);
