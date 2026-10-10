module.exports = (sequelize, DataTypes) => {
  const ProcessingJob = sequelize.define("ProcessingJob", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false, },
    video_source_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "video_sources", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    requested_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id", },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    status: {
      type: DataTypes.ENUM("queued", "processing", "completed", "failed"),
      allowNull: false,
      defaultValue: "queued",
    },
    progress_percent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, },
    started_at: { type: DataTypes.DATE, allowNull: true, },
    finished_at: { type: DataTypes.DATE, allowNull: true, },
    error_message: { type: DataTypes.TEXT, allowNull: true, },
    model_version: { type: DataTypes.STRING(100), allowNull: false, defaultValue: "safeops-det-v1.0", },
    rule_snapshot: { type: DataTypes.JSON, allowNull: false, },
  },
    {
      tableName: "processing_jobs",
      timestamps: true,
      underscored: true,
    }
  );

  ProcessingJob.associate = (models) => {
    ProcessingJob.belongsTo(models.VideoSource, { foreignKey: "video_source_id", as: "video_source", });
    ProcessingJob.belongsTo(models.User, { foreignKey: "requested_by", as: "requester", });
    ProcessingJob.hasMany(models.DetectionEvent, { foreignKey: "processing_job_id", as: "events", });
  };

  return ProcessingJob;
};