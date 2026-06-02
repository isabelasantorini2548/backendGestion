module.exports = (sequelize,DataTypes)=>{

const EventoObjetivo = sequelize.define('EventoObjetivo', {
  idevento: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references:{
      model:'evento',
      key:'idevento'
    }
  },
  idobjetivo: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references:{
      model:'objetivos',
      key: 'idobjetivo'
    }
  },
  texto_personalizado: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'evento_objetivos',
  timestamps: false,
  id: false
});

return EventoObjetivo;
}