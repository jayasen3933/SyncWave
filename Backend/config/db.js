// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    console.log("🔄 Connecting to MongoDB...");

    const mongoUri = process.env.MONGO_URI?.trim();
    if (!mongoUri) {
      throw new Error('MONGO_URI is not configured. Set it to a mongodb:// or mongodb+srv:// connection string.');
    }
    if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) {
      throw new Error('MONGO_URI must start with mongodb:// or mongodb+srv://.');
    }

    const conn = await mongoose.connect(mongoUri);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1); // Exit process with failure
  }
};

module.exports = connectDB;