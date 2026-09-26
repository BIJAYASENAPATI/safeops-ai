module.exports = (sequelize, DataTypes) => {
  const EscalationRule = sequelize.define("EscalationRule", {
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
      onDelete: "CASCADE",
    },
    severity_threshold: {
      type: DataTypes.ENUM("low", "medium", "high", "critical"),
      allowNull: false,
    },
    timeout_minutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
      },
    },
    escalation_contact_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
  },
    {
      tableName: "escalation_rules",
      timestamps: true,
      underscored: true,
    }
  );

  EscalationRule.associate = (models) => {
    EscalationRule.belongsTo(models.Zone, { foreignKey: "zone_id", as: "zone", });
    EscalationRule.belongsTo(models.User, { foreignKey: "escalation_contact_id", as: "escalation_contact", });
  };

  return EscalationRule;
};