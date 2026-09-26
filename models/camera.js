module.exports = (sequelize, DataTypes) => {
  const Camera = sequelize.define(
    "Camera",
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
        references: {
          model: "zones",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      feed_type: {
        type: DataTypes.ENUM("upload", "simulated", "rtsp"),
        allowNull: false,
      },
      feed_url_or_path: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("online", "offline", "error"),
        allowNull: false,
        defaultValue: "offline",
      },
      last_heartbeat_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "cameras",
      timestamps: true,
      underscored: true,
    }
  );

  Camera.associate = (models) => {
    Camera.belongsTo(models.Zone, {
      foreignKey: "zone_id",
      as: "zone",
    });
    Camera.hasMany(models.Incident, {
      foreignKey: "camera_id",
      as: "incidents",
    });
  };

  return Camera;
};
