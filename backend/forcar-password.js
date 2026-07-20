require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Utilizador = require('./models/Utilizador');

async function forcarPassword() {
  try {
    console.log('🔌 A ligar à base de dados...');
    await mongoose.connect(process.env.MONGO_URI);
    
    // 1. Gerar a hash de forma limpa e isolada
    const salt = await bcrypt.genSalt(10);
    const hashSegura = await bcrypt.hash('password123', salt);
    
    // 2. Injeção direta: Bypass aos hooks e ao 'select: false'
    const resultado = await Utilizador.updateOne(
      { email: 'admin@fisiocell.com' },
      { $set: { 
          password: hashSegura,
          ativo: true,
          estado: 'ativo' // Previne qualquer bloqueio de conta inativa
        } 
      }
    );
    
    console.log('✅ Operação cirúrgica concluída com sucesso!');
    console.log(resultado);
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error);
    process.exit(1);
  }
}

forcarPassword();
