// models/Objetivo.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const Argumentacion = sequelize.define('Argumentacion', {
    idargumentacion: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
   idobjetivo: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'idobjetivo',
       references: {
        model: 'objetivo',
        key: 'idobjetivo'
      }
    },
    texto_argumentacion: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'texto_argumentacion',
    },
   
  }, {
    tableName: 'argumentacion', // Nombre de la tabla "hija"
    timestamps: false,
  });

return Argumentacion;
};