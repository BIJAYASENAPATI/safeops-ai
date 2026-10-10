const jwt = require("jsonwebtoken");
const db = require("../db/db-connection");
const userController = require("../controllers/user-controller");

function mockReq(user, params = {}, body = {}, query = {}) {
  return {
    user,
    params,
    body,
    query,
    headers: { authorization: user ? "Bearer mock-token" : undefined },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log("Starting QR Flow tests...\n");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Fetch test users from database
    const superAdmin = await db.User.findOne({ where: { role: "super_admin" } });
    const users = await db.User.findAll({ limit: 10 });

    if (!superAdmin) {
      console.error("No super admin found for tests.");
      process.exit(1);
    }

    const testUser = users.find(u => u.id !== superAdmin.id && u.account_status === "active" && u.invite_status === "accepted");
    if (!testUser) {
      console.error("No active accepted test user found.");
      process.exit(1);
    }

    console.log(`Using Super Admin (ID: ${superAdmin.id}) and Test User (ID: ${testUser.id}, Plant: ${testUser.plant_id})`);

    // Test 1: Admin generates eligible user's QR
    let req = mockReq(superAdmin, { id: testUser.id });
    let res = mockRes();
    await userController.generateUserQR(req, res);
    assert(res.statusCode === 200, "Admin generates an eligible user's QR -> 200");
    assert(res.data && res.data.qr_code && res.data.qr_code.startsWith("data:image/png;base64,"), "Returns valid data:image/png;base64 URL");
    const initialQr = res.data.qr_code;
    const initialGeneratedAt = res.data.generated_at;

    // Test 2: Fetch the same QR
    req = mockReq(superAdmin, { id: testUser.id });
    res = mockRes();
    await userController.getUserQR(req, res);
    assert(res.statusCode === 200, "Fetch the same QR -> 200");
    assert(res.data.qr_code === initialQr, "Fetched QR image matches generated image");

    // Test 3: Generate again -> existing identifier reused
    req = mockReq(superAdmin, { id: testUser.id });
    res = mockRes();
    await userController.generateUserQR(req, res);
    assert(res.statusCode === 200, "Generate again -> 200");
    assert(res.data.qr_code === initialQr, "Existing identifier and QR code reused");

    // Test 4: User fetches their own QR
    req = mockReq(testUser, { id: testUser.id });
    res = mockRes();
    await userController.getUserQR(req, res);
    assert(res.statusCode === 200, "User fetches their own QR -> 200");
    assert(res.data.qr_code === initialQr, "User gets their own QR code");

    // Test 5: Operator requests another user's QR -> 403
    const operator = { id: 99999, role: "operator", plant_id: testUser.plant_id };
    req = mockReq(operator, { id: testUser.id });
    res = mockRes();
    await userController.getUserQR(req, res);
    assert(res.statusCode === 403, "Operator requests another user's QR -> 403");

    // Test 6: Plant admin from another plant requests user's QR -> 403
    const diffPlantAdmin = { id: 88888, role: "admin", plant_id: (testUser.plant_id || 1) + 999 };
    req = mockReq(diffPlantAdmin, { id: testUser.id });
    res = mockRes();
    await userController.getUserQR(req, res);
    assert(res.statusCode === 403, "Plant admin requests another plant's user QR -> 403");

    // Test 7: Reject disabled user
    const disabledUser = { id: 77777, role: "operator", account_status: "disabled", invite_status: "accepted" };
    // Temporarily mock User.findByPk for disabled check
    const origFindByPk = db.User.findByPk;
    db.User.findByPk = async (id, opts) => {
      if (Number(id) === 77777) return disabledUser;
      return origFindByPk.call(db.User, id, opts);
    };
    req = mockReq(superAdmin, { id: 77777 });
    res = mockRes();
    await userController.generateUserQR(req, res);
    assert(res.statusCode === 400, "Generate for disabled user -> Rejected with 400");
    db.User.findByPk = origFindByPk;

    // Test 8: Lookup user by QR identifier
    const reloaded = await db.User.findByPk(testUser.id);
    req = mockReq(superAdmin, {}, { qr_identifier: reloaded.qr_identifier });
    res = mockRes();
    await userController.lookupUserByQR(req, res);
    assert(res.statusCode === 200, "Lookup with raw qr_identifier -> 200");
    assert(res.data.id === testUser.id, "Lookup returns correct user");

    // Test 9: Lookup with safeops:user: prefix
    req = mockReq(superAdmin, {}, { qr_identifier: `safeops:user:${reloaded.qr_identifier}` });
    res = mockRes();
    await userController.lookupUserByQR(req, res);
    assert(res.statusCode === 200, "Lookup with prefixed qr_identifier -> 200");

    // Test 10: Lookup from another plant -> 403
    const otherPlantUser = { id: 66666, role: "operator", plant_id: (testUser.plant_id || 1) + 888 };
    req = mockReq(otherPlantUser, {}, { qr_identifier: reloaded.qr_identifier });
    res = mockRes();
    await userController.lookupUserByQR(req, res);
    assert(res.statusCode === 403, "Possessing QR from another plant does NOT grant access -> 403");

    // Test 11: Regenerate/revoke QR
    req = mockReq(superAdmin, { id: testUser.id });
    res = mockRes();
    await userController.revokeOrRegenerateUserQR(req, res);
    assert(res.statusCode === 200, "Regenerate QR -> 200");
    assert(res.data.qr_code !== initialQr, "New QR code differs from revoked one");

    // Test 12: Old QR identifier no longer resolves
    req = mockReq(superAdmin, {}, { qr_identifier: reloaded.qr_identifier });
    res = mockRes();
    await userController.lookupUserByQR(req, res);
    assert(res.statusCode === 404, "Lookup with revoked identifier -> 404");

    console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  }
}

runTests();
