module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define("User", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false, },
    plant_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "plants", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    name: { type: DataTypes.STRING, allowNull: false, },
    email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true, }, },
    phone_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
      unique: true,
    },
    password_hash: { type: DataTypes.STRING, allowNull: true, },
    role: {
      type: DataTypes.ENUM("operator", "manager", "admin", "super_admin", "system"),
      allowNull: false,
      defaultValue: "operator",
    },
    invited_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    invite_status: { type: DataTypes.ENUM("pending", "accepted"), allowNull: false, defaultValue: "pending", },
    account_status: { type: DataTypes.ENUM("active", "disabled"), allowNull: false, defaultValue: "active", },
    last_login_at: { type: DataTypes.DATE, allowNull: true, },
  },
    {
      tableName: "users",
      timestamps: true,
      underscored: true,
    }
  );

  User.associate = (models) => {
    User.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant", });
    User.belongsTo(models.User, { foreignKey: "invited_by", as: "inviter", });
    User.hasMany(models.Incident, { foreignKey: "assigned_operator_id", as: "assigned_incidents", });
    User.hasMany(models.EscalationRule, { foreignKey: "escalation_contact_id", as: "escalation_rules", });
    User.hasMany(models.AuditLogEntry, { foreignKey: "actor_id", as: "audit_log_entries", });
    User.hasMany(models.User, { foreignKey: "invited_by", as: "invitees", });
    User.hasMany(models.InvitationToken, { foreignKey: "user_id", as: "invitation_tokens", });
    User.hasMany(models.Notification, { foreignKey: "recipient_id", as: "notifications", });
  };

  return User;
};