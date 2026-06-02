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
  
}, {
  tableName: 'subcategoria',
  timestamps: false 
});

return Subcategoria;
};