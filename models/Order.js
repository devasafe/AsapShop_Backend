const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true }, // pode ser Product.id (custom) ou _id do Mongo
    title: String,
    unit_price: Number,
    quantity: Number,
    size: String,
    color: String,
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    paymentId: { type: String, unique: true, index: true },
    userId: { type: String, index: true },
    status: { type: String, default: 'pending' },
    paymentMethod: { type: String }, // adicionado: forma de pagamento
    items: [OrderItemSchema],
    amount: Number,
    shipping: { type: Number, default: 0 },
    total: Number,
    address: mongoose.Schema.Types.Mixed,
    phone: String,
    payerEmail: String,
    gateway: { type: String, default: 'mercadopago' },
    raw: mongoose.Schema.Types.Mixed, // payload completo do MP
  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', OrderSchema);