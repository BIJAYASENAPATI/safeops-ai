module.exports = (sequelize, DataTypes) => {
  const VideoSource = sequelize.define("VideoSource", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false, },
    camera_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "cameras", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    uploaded_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    original_name: { type: DataTypes.STRING, allowNull: false, },
    storage_key: { type: DataTypes.STRING(500), allowNull: false, },
    mime_type: { type: DataTypes.STRING(100), allowNull: false, },
    size_bytes: { type: DataTypes.BIGINT, allowNull: false, },
    duration_seconds: { type: DataTypes.FLOAT, allowNull: true, },
    width: { type: DataTypes.INTEGER, allowNull: true, },
    height: { type: DataTypes.INTEGER, allowNull: true, },
    status: {
      type: DataTypes.ENUM("ready", "invalid", "archived", "deleted"),
      allowNull: false,
      defaultValue: "ready",
    },
    deleted_at: { type: DataTypes.DATE, allowNull: true, },
  },
    {
      tableName: "video_sources",
      timestamps: true,
      underscored: true,
    }
  );

  VideoSource.associate = (models) => {
    VideoSource.belongsTo(models.Camera, { foreignKey: "camera_id", as: "camera", });
    VideoSource.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader", });
    VideoSource.hasMany(models.ProcessingJob, { foreignKey: "video_source_id", as: "jobs", });
  };

  return VideoSource;
};