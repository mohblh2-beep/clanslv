const fs = require("fs");
const path = require("path");

const CLANS_FILE = path.join(__dirname, "clans.json");

// إنشاء ملف clans.json إذا لم يكن موجوداً من قبل
if (!fs.existsSync(CLANS_FILE)) {
    fs.writeFileSync(CLANS_FILE, JSON.stringify({}, null, 2), "utf8");
}

// دالة لجلب كافة الكلانات (الأساسية والمضافة ديناميكياً)
function getClans() {
    try {
        const fileData = fs.readFileSync(CLANS_FILE, "utf8");
        return JSON.parse(fileData || "{}");
    } catch (err) {
        console.error("❌ Error reading clans.json:", err);
        return {};
    }
}

// دالة لحفظ كلان جديد في الملف
function saveNewClan(clanKey, clanName, roleID, leaderRoleID) {
    const currentClans = getClans();
    currentClans[clanKey] = {
        name: clanName,
        roleID: roleID,
        leaderRoleID: leaderRoleID
    };
    try {
        fs.writeFileSync(CLANS_FILE, JSON.stringify(currentClans, null, 2), "utf8");
        console.log(`✅ Saved new clan [${clanName}] to clans.json`);
    } catch (err) {
        console.error("❌ Error saving new clan to clans.json:", err);
    }
}

// دالة لحذف كلان من الملف
function deleteClan(clanKey) {
    const currentClans = getClans();
    if (currentClans[clanKey]) {
        delete currentClans[clanKey];
        try {
            fs.writeFileSync(CLANS_FILE, JSON.stringify(currentClans, null, 2), "utf8");
            console.log(`✅ Deleted clan [${clanKey}] from clans.json`);
            return true;
        } catch (err) {
            console.error("❌ Error deleting clan from clans.json:", err);
            return false;
        }
    }
    return false;
}

module.exports = {
    // الآيديهات الخاصة بسيرفرك (تأكد من تعديلها إذا لزم الأمر)
    APPLY_CHANNEL_ID: "1547988941154553957",
    ADMIN_LOG_CHANNEL_ID: "1551701383097356369",
    TARGET_MEMBER_ROLE_ID: "1502519345882861608",
    TARGET_LEADER_ROLE_ID: "1547990315275915335",

    get CLANS() {
        return getClans();
    },
    getClans,
    saveNewClan,
    deleteClan
};