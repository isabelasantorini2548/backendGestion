module.exports = (sequelize,DataTypes) => {
const ObjetivoSegmento = sequelize.define('ObjetivoSegmento', {
  idobjetivo: {
    type: DataTypes.INTEGER,
    allowNull: false,
    primaryKey: true,
    field: 'idobjetivo', 
      references: { model: 'Objetivo', key: 'idobjetivo' }
  },
  idsegmento: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
    field: 'idsegmento', 
      references: { model: 'Segmento', key: 'idsegmento' }
  },
  texto_personalizado: {
    type: DataTypes.STRING,
    allowNull: false,
  }
}, {
  tableName: 'objetivo_segmento', 
  timestamps: false ,
});

return  ObjetivoSegmento;
};