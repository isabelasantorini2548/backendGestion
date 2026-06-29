const { DataTypes } = require('sequelize');
module.exports = (sequelize,DataTypes) => {
const Subcategoria = sequelize.define('Subcategoria', {
  idsubcategoria: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombreSubcategoria: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  idclasificacion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'clasificacion_estrategica',
      key: 'idclasificacion'
    }
  }
  
}, {
  tableName: 'subcategoria',
  timestamps: false 
});
Subcategoria.associate = function(models) {
  Subcategoria.hasMany(models.Evento,
     { foreignKey: 'idsubcategoria' });
  };
  
  Subcategoria.belongsTo(models.ClasificacionEstrategica, {
    foreignKey: 'idclasificacion',
    as: 'clasificacion'
  });

return Subcategoria;
};