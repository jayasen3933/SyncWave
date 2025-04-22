// deploy-setup.js
const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up deployment configuration...');

// Define file paths
const productionConfigPath = path.join(__dirname, 'config', 'firebase.js.production');
const targetConfigPath = path.join(__dirname, 'config', 'firebase.js');

// Check if production config exists
if (!fs.existsSync(productionConfigPath)) {
    console.error('❌ Production firebase config not found!');
    process.exit(1);
}

try {
    // Copy production config to target path
    fs.copyFileSync(productionConfigPath, targetConfigPath);
    console.log('✅ Firebase production configuration copied successfully!');
} catch (error) {
    console.error('❌ Error setting up Firebase configuration:', error);
    process.exit(1);
}

console.log('🚀 Deployment setup complete!');