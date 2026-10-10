module.exports = (sequelize, DataTypes) => {
  const Incident = sequelize.define("Incident", {
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
      onDelete: "RESTRICT",
    },
    camera_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "cameras", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    processing_job_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "processing_jobs", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    event_type: {
      type: DataTypes.ENUM("ppe_violation", "restricted_entry", "smoke", "fire"),
      allowNull: false,
    },
    severity: { type: DataTypes.STRING, allowNull: false, },
    confidence_score: {
      type: DataTypes.FLOAT,
      allowNull: true,
      validate: { min: 0, max: 1, },
    },
    evidence_url: { type: DataTypes.TEXT, allowNull: true, },
    video_start_ms: { type: DataTypes.INTEGER, allowNull: true, },
    video_end_ms: { type: DataTypes.INTEGER, allowNull: true, },
    idempotency_key: { type: DataTypes.STRING(255), allowNull: true, unique: true, },
    evidence_metadata: { type: DataTypes.JSON, allowNull: true, },
    status: {
      type: DataTypes.ENUM("open", "acknowledged", "escalated", "resolved", "false_positive"),
      allowNull: false,
      defaultValue: "open",
    },
    assigned_operator_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    acknowledged_at: { type: DataTypes.DATE, allowNull: true, },
    escalation_due_at: { type: DataTypes.DATE, allowNull: true, },
    escalation_rule_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "escalation_rules", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    escalation_contact_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    escalated_at: { type: DataTypes.DATE, allowNull: true, },
    resolved_at: { type: DataTypes.DATE, allowNull: true, },
    resolution_notes: { type: DataTypes.TEXT, allowNull: true, },
    dismissed_at: { type: DataTypes.DATE, allowNull: true, },
    dismissal_reason: { type: DataTypes.TEXT, allowNull: true, },
  },
    {
      tableName: "incidents",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
    }
  );

  Incident.associate = (models) => {
    Incident.belongsTo(models.Zone, { foreignKey: "zone_id", as: "zone", });
    Incident.belongsTo(models.Camera, { foreignKey: "camera_id", as: "camera", });
    Incident.belongsTo(models.ProcessingJob, { foreignKey: "processing_job_id", as: "processing_job", });
    Incident.belongsTo(models.User, { foreignKey: "assigned_operator_id", as: "assigned_operator", });
    Incident.belongsTo(models.EscalationRule, { foreignKey: "escalation_rule_id", as: "escalation_rule", });
    Incident.belongsTo(models.User, { foreignKey: "escalation_contact_id", as: "escalation_contact", });
    Incident.hasMany(models.AuditLogEntry, { foreignKey: "incident_id", as: "audit_log_entries", });
    Incident.hasMany(models.DetectionEvent, { foreignKey: "incident_id", as: "detection_events", });
    Incident.hasMany(models.Notification, { foreignKey: "incident_id", as: "notifications", });
  };

  return Incident;
};