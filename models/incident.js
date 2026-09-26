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
      references: {
        model: "zones",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    camera_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "cameras",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    event_type: {
      type: DataTypes.ENUM("ppe_violation", "smoke", "fire"),
      allowNull: false,
    },
    severity: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    confidence_score: {
      type: DataTypes.FLOAT,
      allowNull: true,
      validate: { min: 0, max: 1, },
    },
    evidence_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("open", "acknowledged", "escalated", "resolved", "false_positive"),
      allowNull: false,
      defaultValue: "open",
    },
    assigned_operator_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    acknowledged_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    escalated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
    {
      tableName: "incidents",
      createdAt: "created_at",
      updatedAt: false,
      underscored: true,
    }
  );

  Incident.associate = (models) => {
    Incident.belongsTo(models.Zone, { foreignKey: "zone_id", as: "zone", });
    Incident.belongsTo(models.Camera, { foreignKey: "camera_id", as: "camera", });
    Incident.belongsTo(models.User, { foreignKey: "assigned_operator_id", as: "assigned_operator", });
    Incident.hasMany(models.AuditLogEntry, { foreignKey: "incident_id", as: "audit_log_entries", });
  };

  return Incident;
};