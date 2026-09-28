module.exports = (sequelize, DataTypes) => {
  const Plant = sequelize.define("Plant", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    timezone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },
  },
    {
      tableName: "plants",
      timestamps: true,
      underscored: true,
    }
  );
  Plant.associate = (models) => {
    Plant.hasMany(models.Zone, { foreignKey: "plant_id", as: "zones", });
    Plant.hasMany(models.User, { foreignKey: "plant_id", as: "users", });
  };

  return Plant;
};