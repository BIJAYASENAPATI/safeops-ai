module.exports = (sequelize, DataTypes) => {
  const ZoneSafetyRule = sequelize.define("ZoneSafetyRule",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      zone_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "zones", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      event_type: {
        type: DataTypes.ENUM("ppe_violation", "restricted_entry", "smoke", "fire"),
        allowNull: false,
      },
      required_ppe: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      min_confidence: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0.8,
        validate: { min: 0, max: 1, },
      },
      window_frames: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10,
        validate: { min: 1, },
      },
      confirming_frames: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 6,
        validate: { min: 1, },
      },
      cooldown_seconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
        validate: { min: 0, },
      },
      severity: {
        type: DataTypes.ENUM("low", "medium", "high", "critical"),
        allowNull: false,
        defaultValue: "medium",
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      camera_region_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "camera_regions", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
    },
    {
      tableName: "zone_safety_rules",
      timestamps: true,
      underscored: true,
    }
  );

  ZoneSafetyRule.associate = (models) => {
    ZoneSafetyRule.belongsTo(models.Zone, { foreignKey: "zone_id", as: "zone", });
    ZoneSafetyRule.belongsTo(models.CameraRegion, { foreignKey: "camera_region_id", as: "camera_region", });
  };

  return ZoneSafetyRule;
};
