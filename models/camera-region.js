module.exports = (sequelize, DataTypes) => {
  const CameraRegion = sequelize.define("CameraRegion", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false, },
    camera_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "cameras", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    safety_rule_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "zone_safety_rules", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    name: { type: DataTypes.STRING, allowNull: false, },
    polygon: { type: DataTypes.JSON, allowNull: false, },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, },
  },
    {
      tableName: "camera_regions",
      timestamps: true,
      underscored: true,
    }
  );

  CameraRegion.associate = (models) => {
    CameraRegion.belongsTo(models.Camera, { foreignKey: "camera_id", as: "camera", });
    CameraRegion.belongsTo(models.ZoneSafetyRule, { foreignKey: "safety_rule_id", as: "safety_rule", });
    CameraRegion.hasMany(models.DetectionEvent, { foreignKey: "camera_region_id", as: "detection_events", });
  };

  return CameraRegion;
};