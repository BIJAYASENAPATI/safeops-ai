require("dotenv").config();
const bcrypt = require("bcrypt");

async function seedSuperAdmin() {
  const {
    SEED_ADMIN_NAME,
    SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD,
    JWT_SECRET,
  } = process.env;

  // 1. Stop if any required value is missing.
  const missing = [];
  if (!SEED_ADMIN_NAME) missing.push("SEED_ADMIN_NAME");
  if (!SEED_ADMIN_EMAIL) missing.push("SEED_ADMIN_EMAIL");
  if (!SEED_ADMIN_PASSWORD) missing.push("SEED_ADMIN_PASSWORD");
  if (!JWT_SECRET) missing.push("JWT_SECRET");

  if (missing.length > 0) {
    console.error(
      `❌ Missing required environment variable(s): ${missing.join(", ")}`
    );
    process.exit(1);
  }

  const db = require("../db/db-connection");


  try {
    // 2. Check whether a super_admin already exists; if so, stop without creating another.
    const existingSuperAdmin = await db.User.findOne({
      where: { role: "super_admin" },
    });

    if (existingSuperAdmin) {
      console.log(
        `⚠️ A super_admin already exists (${existingSuperAdmin.email}). Aborting seed.`
      );
      process.exit(0);
    }

    const existingEmail = await db.User.findOne({
      where: { email: SEED_ADMIN_EMAIL },
    });

    if (existingEmail) {
      console.error(
        `❌ A user with email ${SEED_ADMIN_EMAIL} already exists with role "${existingEmail.role}". Aborting seed.`
      );
      process.exit(1);
    }

    // 3. Hash the password with bcrypt.
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, saltRounds);

    // 4. Create the user with role: "super_admin", plant_id: null, invite_status: "accepted", and invited_by: null.
    const user = await db.User.create({
      name: SEED_ADMIN_NAME,
      email: SEED_ADMIN_EMAIL,
      password_hash: passwordHash,
      role: "super_admin",
      plant_id: null,
      invite_status: "accepted",
      invited_by: null,
    });

    // 5. Print the created user’s email, never the password or hash.
    console.log(`✅ Super admin created successfully with email: ${user.email}`);
  } catch (error) {
    console.error("❌ Failed to seed super admin:", error.message || error);
    process.exit(1);
  } finally {
    if (db.sequelize) {
      await db.sequelize.close();
    }
  }
}

seedSuperAdmin();
