// models/Objetivo.js
module.exports = (sequelize,DataTypes) => {
  const Resultado = sequelize.define('Resultado', {
    idresultados_esperados: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    idevento: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'evento',
        key: 'idevento',
      },
    },
    satisfaccion_real: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'satisfaccion_real',
    },
    otros_resultados: {
     type: DataTypes.STRING,
     allowNull: true,
     field: 'otros_resultados',
   },
   participacion_esperada: {
     type: DataTypes.STRING,
     allowNull: false,
   },
    satisfaccion_esperada: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  }, {
    tableName: 'resultado', // Nombre de la tabla "hija"
    timestamps: false,
  });
  Resultado.associate = function(models){
    Resultado.belongsTo(models.Evento, { foreignKey: 'idevento',as:'evento' });

  }
  return Resultado;
};
//Evento.hasOne(Resultado, { foreignKey: 'idevento', as: 'resultado'});