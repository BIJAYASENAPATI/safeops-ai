module.exports = (sequelize, DataTypes) => {
  const DetectionEvent = sequelize.define("DetectionEvent",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false, },
      processing_job_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "processing_jobs", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      camera_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "cameras", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      zone_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "zones", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      safety_rule_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "zone_safety_rules", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      camera_region_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "camera_regions", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      event_type: {
        type: DataTypes.ENUM("ppe_violation", "restricted_entry", "smoke", "fire"),
        allowNull: false,
      },
      track_id: { type: DataTypes.STRING(100), allowNull: true, },
      confidence_score: { type: DataTypes.FLOAT, allowNull: false, },
      video_start_ms: { type: DataTypes.INTEGER, allowNull: false, },
      video_end_ms: { type: DataTypes.INTEGER, allowNull: false, },
      observed_at: { type: DataTypes.DATE, allowNull: true, },
      detected_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, },
      verification_status: {
        type: DataTypes.ENUM("pending", "verified", "rejected"),
        allowNull: false,
        defaultValue: "pending",
      },
      evidence_storage_key: { type: DataTypes.STRING(500), allowNull: true, },
      metadata: { type: DataTypes.JSON, allowNull: true, },
      incident_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "incidents", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
    },
    {
      tableName: "detection_events",
      timestamps: true,
      updatedAt: false,
      underscored: true,
    }
  );

  DetectionEvent.associate = (models) => {
    DetectionEvent.belongsTo(models.ProcessingJob, { foreignKey: "processing_job_id", as: "job", });
    DetectionEvent.belongsTo(models.Camera, { foreignKey: "camera_id", as: "camera", });
    DetectionEvent.belongsTo(models.Zone, { foreignKey: "zone_id", as: "zone", });
    DetectionEvent.belongsTo(models.ZoneSafetyRule, { foreignKey: "safety_rule_id", as: "safety_rule", });
    DetectionEvent.belongsTo(models.CameraRegion, { foreignKey: "camera_region_id", as: "region", });
    DetectionEvent.belongsTo(models.Incident, { foreignKey: "incident_id", as: "incident", });
  };

  return DetectionEvent;
};