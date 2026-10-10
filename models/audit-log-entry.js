module.exports = (sequelize, DataTypes) => {
  const AuditLogEntry = sequelize.define("AuditLogEntry", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    incident_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "incidents", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    actor_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    action: {
      type: DataTypes.ENUM("acknowledged", "escalated", "resolved", "dismissed", "escalation_error"),
      allowNull: false,
    },
    metadata: { type: DataTypes.JSON, allowNull: true, },
  },
    {
      tableName: "audit_log_entries",
      createdAt: "created_at",
      updatedAt: false,
      underscored: true,
    }
  );

  AuditLogEntry.associate = (models) => {
    AuditLogEntry.belongsTo(models.Incident, { foreignKey: "incident_id", as: "incident", });
    AuditLogEntry.belongsTo(models.User, { foreignKey: "actor_id", as: "actor", });
  };

  return AuditLogEntry;
};