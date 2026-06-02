// models/Participante.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize,DataTypes) => {
const Clasificacion = sequelize.define('ClasificacionEstrategica', {
  idClasificacion: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'idclasificacion'
  },
  nombre_clasificacion: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  idsubcategoria: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'clasificacion_estrategica',
  timestamps: false 
});
  Clasificacion.associate = (models) => {

  }
return Clasificacion;
};