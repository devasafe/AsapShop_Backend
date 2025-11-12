const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  images: [{ type: String, required: true }],
  category: { type: String, required: true },
  new_price: { type: Number, required: true },
  old_price: { type: Number, required: true },
  drop_id: { type: String, required: true },
  drop_start: { type: Date, required: true },
  drop_end: { type: Date, required: true },
  date: { type: Date, default: Date.now },
  available: { type: Boolean, default: true },
  sizes: [String],
  colors: [String],
  stock: { type: Number, default: 0 },
  description: { type: String },
  tags: [String],
  isPromo: { type: Boolean, default: false },
  promoText: { type: String }
});

module.exports = mongoose.model("Product", ProductSchema);
