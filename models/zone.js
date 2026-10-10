module.exports = (sequelize, DataTypes) => {
  const Zone = sequelize.define("Zone", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    plant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "plants", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    name: { type: DataTypes.STRING, allowNull: false, },
    severity_level: {
      type: DataTypes.ENUM("low", "medium", "high", "critical"),
      allowNull: false,
    },
    operating_schedule: { type: DataTypes.JSON, allowNull: true, },
    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },
  },
    {
      tableName: "zones",
      timestamps: true,
      underscored: true,
    }
  );

  Zone.associate = (models) => {
    Zone.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant", });
    Zone.hasMany(models.Camera, { foreignKey: "zone_id", as: "cameras", });
    Zone.hasMany(models.Incident, { foreignKey: "zone_id", as: "incidents", });
    Zone.hasMany(models.EscalationRule, { foreignKey: "zone_id", as: "escalation_rules", });
    Zone.hasMany(models.ZoneSafetyRule, { foreignKey: "zone_id", as: "safety_rules", });
  };

  return Zone;
};