// models/ChatMensaje.js
module.exports = (sequelize, DataTypes) => {
  return sequelize.define('ChatMensaje', {
    id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    evento_id: { type: DataTypes.STRING, allowNull: false },  // ← STRING para soportar 'general' y IDs numéricos
    user_id:   { type: DataTypes.STRING, allowNull: false },  // ← STRING también por seguridad
    role:      { type: DataTypes.STRING(20), allowNull: true },
    user_name: { type: DataTypes.STRING, allowNull: true },
    message:   { type: DataTypes.TEXT, allowNull: false },
  }, {
    tableName: 'chat_mensajes',
    timestamps: true
  });
};