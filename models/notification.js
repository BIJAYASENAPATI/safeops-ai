module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define("Notification",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false, },
      recipient_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      incident_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "incidents", key: "id", },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      type: {
        type: DataTypes.ENUM("incident_created", "incident_escalated"),
        allowNull: false,
      },
      title: { type: DataTypes.STRING(255), allowNull: false, },
      message: { type: DataTypes.TEXT, allowNull: false, },
      read_at: { type: DataTypes.DATE, allowNull: true, },
    },
    {
      tableName: "notifications",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ["incident_id", "recipient_id", "type"],
          name: "uq_notification_incident_recipient_type",
        },
      ],
    }
  );

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { foreignKey: "recipient_id", as: "recipient", });
    Notification.belongsTo(models.Incident, { foreignKey: "incident_id", as: "incident", });
  };

  return Notification;
};
