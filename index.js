require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    MessageFlags
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

const config = require("./config");

// ================= WEB SERVER =================

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Clan Bot Online"));
app.listen(PORT, () => console.log(`Web server running on ${PORT}`));

// ================= DISCORD CLIENT =================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: ["CHANNEL"]
});

const activeCreations = new Map();

client.once("clientReady", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= HELPER FUNCTIONS FOR IMAGES =================
function getCocainaBanner() {
    return fs.existsSync("./COCAINA.png") ? new AttachmentBuilder("./COCAINA.png") : null;
}

function getGifBanner() {
    return fs.existsSync("./Salvadore_Clans.gif") ? new AttachmentBuilder("./Salvadore_Clans.gif") : null;
}

// ================= CLAN DATA HELPERS =================
// توحيد مصدر الكلانات: بعض أجزاء المشروع تستعمل getClans() وبعضها CLANS
function getCurrentClans() {
    if (typeof config.getClans === "function") {
        return config.getClans() || {};
    }
    return config.CLANS || {};
}

// ================= CLAN XP STORAGE SYSTEM =================
// Railway Volume: نستعمل المسار الذي توفره Railway، مع /app/data كمسار افتراضي
// حتى لا نتوقف فقط لأن متغير RAILWAY_VOLUME_MOUNT_PATH غير ظاهر.
// لا يتم قبول /app/data على Railway إلا بعد التأكد أنه Mount Point فعلي.
const DEFAULT_RAILWAY_VOLUME_MOUNT_PATH = "/app/data";
const isRailwayRuntime = Boolean(
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_DEPLOYMENT_ID ||
    process.env.RAILWAY_VOLUME_NAME ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH
);

const volumeMountPath = isRailwayRuntime
    ? (process.env.RAILWAY_VOLUME_MOUNT_PATH || DEFAULT_RAILWAY_VOLUME_MOUNT_PATH)
    : path.join(__dirname, "data");

const xpStorageDir = volumeMountPath;
const clansXPPath = path.join(xpStorageDir, "clansXP.json");
const clansXPBackupPath = path.join(xpStorageDir, "clansXP.json.bak");

function decodeMountInfoPath(value) {
    return value
        .replace(/\\040/g, " ")
        .replace(/\\011/g, "\t")
        .replace(/\\012/g, "\n")
        .replace(/\\134/g, "\\");
}

function isActualMountPoint(mountPath) {
    if (process.platform !== "linux") return false;

    try {
        const mountInfo = fs.readFileSync("/proc/self/mountinfo", "utf8");
        const wanted = path.resolve(mountPath);

        return mountInfo.split("\n").some(line => {
            const separatorIndex = line.indexOf(" - ");
            if (separatorIndex === -1) return false;

            const leftSide = line.slice(0, separatorIndex).split(" ");
            if (leftSide.length < 5) return false;

            const mountPoint = decodeMountInfoPath(leftSide[4]);
            return path.resolve(mountPoint) === wanted;
        });
    } catch (e) {
        console.error("⚠️ Could not inspect /proc/self/mountinfo:", e.message);
        return false;
    }
}

function verifyXPVolumeBeforeBotStart() {
    console.log("==================================================");
    console.log("📦 Clan XP Storage Startup Check");
    console.log(`📄 clansXP.json path: ${clansXPPath}`);

    if (!isRailwayRuntime) {
        console.log("ℹ️ Railway runtime not detected. Local fallback storage is allowed.");
        console.log(`📁 Local XP storage directory: ${xpStorageDir}`);
        console.log("==================================================");
        return true;
    }

    const railwayVolumePath = volumeMountPath;
    const envMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH || "(not provided)";

    console.log(`📦 Railway Volume env mount path: ${envMountPath}`);
    console.log(`📦 Volume path being checked: ${railwayVolumePath}`);

    if (!fs.existsSync(railwayVolumePath)) {
        console.error(`❌ Volume path does not exist: ${railwayVolumePath}`);
        console.error("❌ Attach a Railway Volume to THIS service and set Mount Path to /app/data.");
        console.error("❌ The bot will NOT start to prevent saving XP on ephemeral storage.");
        return false;
    }

    if (!isActualMountPoint(railwayVolumePath)) {
        console.error(`❌ ${railwayVolumePath} exists, but it is NOT detected as an active Railway Volume mount.`);
        console.error("❌ Check Railway → Service → Volumes and make sure the Volume is attached to this service with Mount Path /app/data.");
        console.error("❌ The bot will NOT start to prevent saving XP on ephemeral storage.");
        return false;
    }

    try {
        const testFile = path.join(railwayVolumePath, `.xp-volume-check-${process.pid}.tmp`);
        fs.writeFileSync(testFile, "ok", "utf8");
        fs.unlinkSync(testFile);
    } catch (e) {
        console.error(`❌ Railway Volume is mounted but not writable: ${railwayVolumePath}`);
        console.error(`❌ ${e.message}`);
        console.error("❌ The bot will NOT start.");
        return false;
    }

    console.log("✅ Railway Volume detected and mounted successfully.");
    console.log("✅ Railway Volume is writable.");
    console.log(`✅ XP data will be stored at: ${clansXPPath}`);
    console.log("==================================================");
    return true;
}

function ensureXPStorageDir() {
    try {
        fs.mkdirSync(xpStorageDir, { recursive: true });
    } catch (e) {
        console.error("Error creating XP storage directory:", e);
        throw e;
    }
}

// ترحيل نسخة قديمة موجودة داخل المشروع إلى الـVolume عند أول تشغيل.
function migrateLegacyXPFile() {
    ensureXPStorageDir();

    const legacyPath = path.join(__dirname, "clansXP.json");
    const volumeHasMain = fs.existsSync(clansXPPath);

    if (!volumeHasMain && fs.existsSync(legacyPath) && path.resolve(legacyPath) !== path.resolve(clansXPPath)) {
        try {
            fs.copyFileSync(legacyPath, clansXPPath);
            console.log(`✅ Migrated legacy clansXP.json to ${clansXPPath}`);
        } catch (e) {
            console.error("Error migrating legacy clansXP.json:", e);
        }
    }
}

function parseXPFile(file) {
    try {
        if (!fs.existsSync(file)) return null;
        const raw = fs.readFileSync(file, "utf-8");
        if (!raw.trim()) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

function restoreXPBackup() {
    const backupData = parseXPFile(clansXPBackupPath);

    if (!backupData) {
        console.error("❌ clansXP.json is corrupted and no valid backup was found.");
        return null;
    }

    try {
        fs.copyFileSync(clansXPBackupPath, clansXPPath);
        console.log("♻️ Restored clansXP.json from backup.");
        return backupData;
    } catch (e) {
        console.error("Error restoring clansXP.json backup:", e);
        return backupData;
    }
}

function saveXPData(data) {
    ensureXPStorageDir();

    try {
        // قبل كل عملية حفظ: خذ نسخة من الملف الرئيسي السليم إلى الـbackup.
        if (fs.existsSync(clansXPPath)) {
            const currentData = parseXPFile(clansXPPath);
            if (currentData) {
                fs.copyFileSync(clansXPPath, clansXPBackupPath);
            } else {
                console.warn("⚠️ Current clansXP.json is invalid; keeping the existing backup unchanged.");
            }
        }

        // حفظ ذري: نكتب إلى ملف مؤقت ثم نستبدل الملف الرئيسي.
        const tempPath = `${clansXPPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 4), "utf-8");
        fs.renameSync(tempPath, clansXPPath);
    } catch (e) {
        console.error("Error saving clansXP.json:", e);

        // تنظيف الملف المؤقت إن بقي بعد فشل الحفظ.
        try {
            const tempPath = `${clansXPPath}.tmp`;
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (_) {}
    }
}

function loadXPData() {
    migrateLegacyXPFile();

    const clans = getCurrentClans();
    let data = parseXPFile(clansXPPath);

    // إذا كان الملف الرئيسي تالفاً، استرجع آخر نسخة احتياطية سليمة.
    if (!data && fs.existsSync(clansXPPath)) {
        data = restoreXPBackup();
    }

    if (!data) {
        data = {};
    }

    let hasChanges = false;

    Object.keys(clans).forEach(clanKey => {
        if (!data[clanKey]) {
            data[clanKey] = {
                xp: 0,
                dailyXp: 0,
                lastActive: Date.now()
            };
            hasChanges = true;
        } else {
            if (typeof data[clanKey].xp !== "number") {
                data[clanKey].xp = Number(data[clanKey].xp) || 0;
                hasChanges = true;
            }
            if (typeof data[clanKey].dailyXp !== "number") {
                data[clanKey].dailyXp = Number(data[clanKey].dailyXp) || 0;
                hasChanges = true;
            }
            if (!data[clanKey].lastActive) {
                data[clanKey].lastActive = Date.now();
                hasChanges = true;
            }
        }
    });

    if (hasChanges || !fs.existsSync(clansXPPath)) {
        saveXPData(data);
    }

    return data;
}

function addClanXP(clanKey, xpAmount) {
    const data = loadXPData();

    if (!data[clanKey]) {
        data[clanKey] = {
            xp: 0,
            dailyXp: 0,
            lastActive: Date.now()
        };
    }

    data[clanKey].xp = (data[clanKey].xp || 0) + xpAmount;
    data[clanKey].dailyXp = (data[clanKey].dailyXp || 0) + xpAmount;
    data[clanKey].lastActive = Date.now();

    saveXPData(data);
}

// ================= CLAN XP SYSTEM =================
const XP_CHANNEL_ID = "1525169997628833842";
const VERIFIED_ROLE_ID = "1502519400249426070";
let leaderboardMessage = null;

// ================= LEADERBOARD MESSAGE RESTORE =================
client.once("clientReady", async () => {
    console.log("🔥 Clan XP System Loaded!");

    const xpChannel = client.channels.cache.get(XP_CHANNEL_ID);
    if (xpChannel) {
        try {
            const messages = await xpChannel.messages.fetch({ limit: 10 });
            const foundMsg = messages.find(
                m =>
                    m.author.id === client.user.id &&
                    m.embeds.length > 0 &&
                    m.embeds[0].description?.includes("CLAN LEADERBOARD")
            );

            if (foundMsg) {
                leaderboardMessage = foundMsg;
                console.log("✅ Restored active Leaderboard message from channel.");
            }
        } catch (err) {
            console.error("Could not fetch old leaderboard message:", err);
        }
    }
});

// ================= XP EVERY 5 MINUTES =================
setInterval(async () => {
    try {
        getCurrentClans();

        client.guilds.cache.forEach(async guild => {
            await guild.members.fetch().catch(() => {});

            guild.members.cache.forEach(member => {
                if (member.user.bot) return;
                if (!member.voice.channel) return;

                const channel = member.voice.channel;

                // تجاهل روم AFK
                if (channel.name && channel.name.toLowerCase().includes("afk")) return;

                // لازم يكون معاه شخص آخر
                const humans = channel.members.filter(m => !m.user.bot);
                if (humans.size < 2) return;

                // إذا كان ميوت أو ديف
                if (member.voice.selfMute || member.voice.selfDeaf) return;

                const currentClans = getCurrentClans();
                let clanKey = null;

                for (const [key, clan] of Object.entries(currentClans)) {
                    if (member.roles.cache.has(clan.roleID)) {
                        clanKey = key;
                        break;
                    }
                }

                if (!clanKey) return;

                addClanXP(clanKey, 10);
            });
        });
    } catch (err) {
        console.error("Error in Clan XP interval:", err);
    }
}, 5 * 60 * 1000);

// ================= UPDATE LEADERBOARD =================
setInterval(async () => {
    if (!leaderboardMessage) return;

    try {
        const data = loadXPData();
        const currentClans = getCurrentClans();

        const clans = Object.entries(currentClans)
            .map(([key, clan]) => ({
                key,
                name: clan.name,
                xp: data[key]?.xp || 0
            }))
            .sort((a, b) => b.xp - a.xp);

        const baseMedals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        const maxXP = Math.max(...clans.map(c => c.xp), 1);

        let desc = "# 🏆 CLAN LEADERBOARD\n\n";

        if (clans.length === 0) {
            desc += "لا يوجد أي كلانات مسجلة حالياً.\n\n";
        } else {
            clans.forEach((clan, index) => {
                const barLength = Math.round((clan.xp / maxXP) * 10);
                const bar = "🟪".repeat(barLength) + "⬜".repeat(10 - barLength);
                const medalIcon = baseMedals[index] || `**#${index + 1}**`;

                desc += `${medalIcon} **${clan.name}**\n${bar}\n**${clan.xp} XP**\n\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setColor("#8A2BE2")
            .setDescription(desc)
            .setTimestamp();

        await leaderboardMessage.edit({ embeds: [embed] }).catch(() => {});
    } catch (err) {
        console.log("Error updating leaderboard:", err);
    }
}, 60000);

// ================= DAILY REPORT =================
setInterval(async () => {
    const now = new Date();

    if (now.getHours() !== 0 || now.getMinutes() !== 0) return;

    try {
        const data = loadXPData();
        const currentClans = getCurrentClans();

        const clans = Object.entries(currentClans)
            .map(([key, clan]) => ({
                key,
                name: clan.name,
                daily: data[key]?.dailyXp || 0
            }))
            .sort((a, b) => b.daily - a.daily);

        if (clans.length === 0) return;

        const baseMedals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        let report = `@everyone <@&${VERIFIED_ROLE_ID}>\n\n# 📊 Daily Clan Report\n\n`;

        clans.forEach((clan, index) => {
            const medalIcon = baseMedals[index] || `**#${index + 1}**`;
            report += `${medalIcon} ${clan.name}\n+${clan.daily} XP\n\n`;
        });

        report += "🔥 Keep playing in voice channels to earn more XP!";

        const channel = client.channels.cache.get(XP_CHANNEL_ID);
        if (channel) {
            await channel.send(report).catch(() => {});
        }

        Object.keys(data).forEach(key => {
            if (data[key]) data[key].dailyXp = 0;
        });

        saveXPData(data);
    } catch (err) {
        console.error("Error in daily clan report:", err);
    }
}, 60000);

// ================= MONTHLY SEASON =================
setInterval(async () => {
    const now = new Date();

    if (now.getDate() !== 1 || now.getHours() !== 0 || now.getMinutes() !== 1) return;

    try {
        const data = loadXPData();
        const currentClans = getCurrentClans();

        const clans = Object.entries(currentClans)
            .map(([key, clan]) => ({
                key,
                name: clan.name,
                xp: data[key]?.xp || 0
            }))
            .sort((a, b) => b.xp - a.xp);

        const winner = clans[0];
        const channel = client.channels.cache.get(XP_CHANNEL_ID);

        if (channel && winner && winner.xp > 0) {
            await channel.send(
                `@everyone <@&${VERIFIED_ROLE_ID}>\n\n# 🏆 Season Finished\n\n🥇 Winner\n\n**${winner.name}**\n\n⭐ ${winner.xp} XP\n\nCongratulations! 🎉`
            ).catch(() => {});
        }

        const newData = {};

        Object.keys(currentClans).forEach(key => {
            newData[key] = {
                xp: 0,
                dailyXp: 0,
                lastActive: Date.now()
            };
        });

        saveXPData(newData);
    } catch (err) {
        console.error("Error in monthly clan season:", err);
    }
}, 60000);

function buildClanApplyButtons() {
    const clans = getCurrentClans();
    const rows = [];
    let currentRow = new ActionRowBuilder();

    Object.entries(clans).forEach(([key, clan], index) => {
        if (index > 0 && index % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
        
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`apply_${key}`)
                .setLabel(clan.name.substring(0, 30))
                .setStyle(ButtonStyle.Primary)
        );
    });

    if (currentRow.components.length > 0) {
        rows.push(currentRow);
    }
    return rows;
}

// ================= PANEL CREATION & ADMIN COMMANDS =================

client.on("messageCreate", async message => {
    if (message.author.bot || !message.guild) return;

    // 1. لوحة التقديم المعتادة (*clan)
    if (message.content === "*clan") {
        const banner = getCocainaBanner();
        const clans = getCurrentClans();
        
        let clansDescription = "";
        Object.entries(clans).forEach(([key, clan]) => {
            clansDescription += `• **${clan.name}**\n`;
        });

        if (!clansDescription) clansDescription = "لا توجد كلانات متاحة حالياً.";

        const embed = new EmbedBuilder()
            .setTitle("🏆 CLAN RECRUITMENT CENTER")
            .setDescription(`
**Welcome to the official clan recruitment system.**

Choose the clan you want to join by clicking one of the buttons below and complete the application form.

━━━━━━━━━━━━━━━━━━━━━━

📌 **Before applying**
• Fill in all information correctly.
• Submit only one application.
• Wait patiently for the leader's decision.

━━━━━━━━━━━━━━━━━━━━━━

${clansDescription}

━━━━━━━━━━━━━━━━━━━━━━
**Click one of the buttons below to start your application.**
`)
            .setColor("#8A2BE2")
            .setFooter({ text: "Official Clan Recruitment System" })
            .setTimestamp();

        if (banner) embed.setImage("attachment://COCAINA.png");

        const rows = buildClanApplyButtons();
        const channel = message.guild.channels.cache.get(config.APPLY_CHANNEL_ID) || message.channel;

        await channel.send({
            embeds: [embed],
            components: rows,
            files: banner ? [banner] : []
        });

        return message.reply("✅ Apply Panel created successfully.");
    }

    // 2. لوحة التأسيس (*clancreate)
    if (message.content === "*clancreate") {
        if (!message.member.permissions.has("Administrator")) {
            return message.reply("❌ هذا الأمر مخصص للإدارة فقط!");
        }

        const banner = getGifBanner();
        const embed = new EmbedBuilder()
            .setTitle("⚜️ مركز تقديم وتأسيس الكلانات الرسمية ⚜️")
            .setDescription(`
يررحب بكم السيرفر لتقديم طلبات فتح كلاناتكم الخاصة. يرجى قراءة الشروط المطلوبة بدقة قبل البدء بالتقديم:

━━━━━━━━━━━━━━━━━━━━━━

⚠️ **شروط تقديم فتح كلان جديد / Clan Requirements:**

1️⃣ **أقدمية القائد / Leader Age:**
يجب أن يكون حساب القائد (Leader) قد أمضى ما لا يقل عن **15 يوماً** داخل هذا السيرفر.

2️⃣ **الحد الأدنى للأعضاء / Minimum Members:**
يجب توفر **8 أعضاء نشطين** فما فوق (القائد + 7 أعضاء مستعدين للانضمام فوراً).

3️⃣ **الاسم والشعار / Clan Name:**
يجب أن يكون اسم الكلان محترماً وغير مخالف لمعايير مجتمعنا أو يحمل أي إساءة.

━━━━━━━━━━━━━━━━━━━━━━

💡 **آلية عمل التقديم الذكية:**
بمجرد الضغط على زر التأسيس بالأسفل، سيُطلب منك ملء بيانات كلانك، ثم سيمنحك البوت قائمة منسدلة لاختيار أعضائك الـ 7.
سيقوم البوت تلقائياً بإرسال دعوات في الخاص لأعضائك، ولديهم مهلة **24 ساعة** للموافقة جميعاً. عند اكتمال الموافقة، سيصل طلبك رسمياً للإدارة للبت فيه وقبول الكلان برمجياً!
`)
            .setColor("#F1C40F")
            .setFooter({ text: "نظام التأسيس الآلي للكلانات" })
            .setTimestamp();

        if (banner) embed.setImage("attachment://Salvadore_Clans.gif");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("start_creation_flow")
                .setLabel("📝 تقديم طلب تأسيس كلان")
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({
            embeds: [embed],
            components: [row],
            files: banner ? [banner] : []
        });

        return message.reply("✅ تم إنشاء واجهة التأسيس بنجاح.");
    }

    // 3. واجهة الحذف (*clandelete)
    if (message.content === "*clandelete") {
        if (!message.member.permissions.has("Administrator")) {
            return message.reply("❌ هذا الأمر مخصص للإدارة فقط!");
        }

        const clans = getCurrentClans();
        const options = Object.entries(clans).map(([key, clan]) => ({
            label: clan.name.replace(/[\u0080-\uFFFF]/g, '').trim() || "CLAN",
            description: `حذف كلان ${clan.name}`,
            value: key
        }));

        if (options.length === 0) {
            return message.reply("❌ لا توجد كلانات مسجلة في النظام حالياً لحذفها!");
        }

        const banner = getGifBanner();
        const embed = new EmbedBuilder()
            .setTitle("🗑️ لوحة حذف وإلغاء الكلانات")
            .setDescription("الرجاء اختيار الكلان الذي تريد حذفه نهائياً من القائمة المنسدلة أدناه.")
            .setColor("#E74C3C")
            .setTimestamp();

        if (banner) embed.setImage("attachment://Salvadore_Clans.gif");

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("admin_delete_clan_select")
            .setPlaceholder("❌ اختر الكلان المراد حذفه نهائياً")
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return await message.channel.send({
            embeds: [embed],
            components: [row],
            files: banner ? [banner] : []
        });
    }

    // 4. أمر طرد عضو من الكلان (*clankick أو *kick)
    if (message.content === "*clankick" || message.content === "*kick") {
        const clans = getCurrentClans();
        const memberRoles = message.member.roles.cache;

        let leaderClanKey = null;
        let leaderClanData = null;

        Object.entries(clans).forEach(([key, clan]) => {
            if (clan.leaderRoleID && memberRoles.has(clan.leaderRoleID)) {
                leaderClanKey = key;
                leaderClanData = clan;
            }
        });

        if (!leaderClanData) {
            return message.reply("❌ أنت لا تمتلك رتبة ليدر (Leader) لأي كلان مسجل في النظام!");
        }

        const embed = new EmbedBuilder()
            .setTitle(`🛡️ إدارة كلان: ${leaderClanData.name}`)
            .setDescription("اختر العضو الذي تريد طرده من الكلان من القائمة المنسدلة أدناه.")
            .setColor("#E74C3C")
            .setTimestamp();

        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId(`kick_clan_member_${leaderClanKey}`)
            .setPlaceholder("🔍 اختر العضو المراد طرده من الكلان")
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        return await message.channel.send({
            embeds: [embed],
            components: [row]
        });
    }
});

// ================= INTERACTIONS HANDLER =================

client.on("interactionCreate", async interaction => {
    try {
        // طرد عضو من الكلان
        if (interaction.isUserSelectMenu() && interaction.customId.startsWith("kick_clan_member_")) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

            const clanKey = interaction.customId.replace("kick_clan_member_", "");
            const clans = getCurrentClans();
            const clan = clans[clanKey];

            if (!clan) {
                return interaction.editReply("❌ تعذر العثور على بيانات الكلان في النظام.").catch(() => {});
            }

            if (!interaction.member.roles.cache.has(clan.leaderRoleID)) {
                return interaction.editReply("❌ ليس لديك صلاحية طرد الأعضاء من هذا الكلان!").catch(() => {});
            }

            const targetUserId = interaction.values[0];

            if (targetUserId === interaction.user.id) {
                return interaction.editReply("❌ لا يمكنك طرد نفسك من الكلان!").catch(() => {});
            }

            const guild = interaction.guild;
            const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

            if (!targetMember) {
                return interaction.editReply("❌ العضو غير موجود في السيرفر.").catch(() => {});
            }

            if (!targetMember.roles.cache.has(clan.roleID)) {
                return interaction.editReply(`❌ العضو <@${targetUserId}> ليس عضواً في كلان **${clan.name}**!`).catch(() => {});
            }

            await targetMember.roles.remove(clan.roleID).catch(err => console.error("Error removing clan role:", err));
            await targetMember.send(`⚠️ تم طردك من كلان **${clan.name}** بواسطة ليدر الكلان.`).catch(() => {});

            return await interaction.editReply({
                content: `✅ تم طرد العضو <@${targetUserId}> من كلان **${clan.name}** بنجاح.`
            }).catch(() => {});
        }

        // حذف الكلان
        if (interaction.isStringSelectMenu() && interaction.customId === "admin_delete_clan_select") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            
            if (!interaction.member.permissions.has("Administrator")) {
                return interaction.editReply("❌ ليس لديك صلاحية تنفيذ هذا الإجراء.").catch(() => {});
            }

            const targetClanKey = interaction.values[0];
            const clans = getCurrentClans();
            const clanData = clans[targetClanKey];

            if (!clanData) {
                return interaction.editReply("❌ تعذر العثور على بيانات الكلان المحدد.").catch(() => {});
            }

            const success = config.deleteClan(targetClanKey);
            if (success) {
                return await interaction.editReply({
                    content: `✅ تم حذف الكلان **${clanData.name}** بنجاح!`,
                    components: []
                }).catch(() => {});
            }
        }

        // 1. بدء التأسيس
        if (interaction.isButton() && interaction.customId === "start_creation_flow") {
            const joinedAt = interaction.member.joinedAt;
            const fifteenDaysInMs = 15 * 24 * 60 * 60 * 1000;
            if (Date.now() - joinedAt.getTime() < fifteenDaysInMs) {
                return interaction.reply({
                    content: "❌ يجب أن تكون قد أمضيت 15 يوماً على الأقل في السيرفر لكي تتمكن من تأسيس كلان.",
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            }

            const modal = new ModalBuilder()
                .setCustomId("clan_creation_modal")
                .setTitle("طلب تأسيس كلان جديد");

            const nameInput = new TextInputBuilder()
                .setCustomId("proposed_name")
                .setLabel("اسم الكلان المقترح")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const descInput = new TextInputBuilder()
                .setCustomId("proposed_desc")
                .setLabel("وصف مختصر عن كلانك")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(nameInput),
                new ActionRowBuilder().addComponents(descInput)
            );

            return await interaction.showModal(modal).catch(() => {});
        }

        // 2. معالجة الـ Modal المبدئي للتأسيس
        if (interaction.isModalSubmit() && interaction.customId === "clan_creation_modal") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

            const clanName = interaction.fields.getTextInputValue("proposed_name");
            const clanDesc = interaction.fields.getTextInputValue("proposed_desc");

            const clanKey = "clan_" + Date.now();

            activeCreations.set(interaction.user.id, {
                leaderId: interaction.user.id,
                clanName,
                clanDesc,
                clanKey,
                invitedUsers: [],
                acceptedUsers: [interaction.user.id],
                createdAt: Date.now()
            });

            const selectMenu = new UserSelectMenuBuilder()
                .setCustomId(`invite_members_${interaction.user.id}`)
                .setPlaceholder("🔍 ابحث واختر الـ 7 أعضاء المكملين للكلان")
                .setMinValues(7)
                .setMaxValues(7);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            return await interaction.editReply({
                content: `✅ تم استلام بيانات كلان **${clanName}**!\n\nاختر **7 أعضاء بالضبط** لدعوتهم:`,
                components: [row]
            }).catch(() => {});
        }

        // 3. دعوة الأعضاء بالخاص
        if (interaction.isUserSelectMenu() && interaction.customId.startsWith("invite_members_")) {
            await interaction.deferUpdate().catch(() => {});
            const leaderId = interaction.customId.split("_")[2];
            
            if (interaction.user.id !== leaderId) {
                return interaction.followUp({ content: "❌ القائد فقط هو المخول باختيار الأعضاء.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            const creationData = activeCreations.get(leaderId);
            if (!creationData) {
                return interaction.followUp({ content: "❌ انتهت مهلة الجلسة، يرجى تقديم الطلب من جديد.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            const selectedUsers = Array.from(interaction.values);
            if (selectedUsers.includes(leaderId)) {
                return interaction.followUp({ content: "❌ لا يمكنك دعوة نفسك! اختر 7 أعضاء آخرين.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            creationData.invitedUsers = selectedUsers;
            activeCreations.set(leaderId, creationData);

            for (const memberId of selectedUsers) {
                const targetUser = await client.users.fetch(memberId).catch(() => null);
                if (targetUser) {
                    const banner = getGifBanner();
                    const inviteEmbed = new EmbedBuilder()
                        .setTitle("📩 دعوة انضمام وتأسيس كلان جديد!")
                        .setDescription(`قام العضو <@${leaderId}> بدعوتك لتأسيس كلان **${creationData.clanName}**.`)
                        .setColor("#3498DB");

                    if (banner) inviteEmbed.setImage("attachment://Salvadore_Clans.gif");

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`accept_invite_${leaderId}_${memberId}`)
                            .setLabel("✅ قبول الدعوة")
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`reject_invite_${leaderId}_${memberId}`)
                            .setLabel("❌ رفض وتجاهل")
                            .setStyle(ButtonStyle.Danger)
                    );

                    await targetUser.send({ embeds: [inviteEmbed], components: [row], files: banner ? [banner] : [] }).catch(() => {});
                }
            }

            return await interaction.editReply({
                content: `✨ تم إرسال طلبات الانضمام بنجاح لجميع الأعضاء الـ 7 في الخاص!`,
                components: []
            }).catch(() => {});
        }

        // 4. موافقة الأعضاء بالخاص
        if (interaction.isButton() && interaction.customId.startsWith("accept_invite_")) {
            await interaction.deferUpdate().catch(() => {});
            const [, , leaderId, memberId] = interaction.customId.split("_");

            const creationData = activeCreations.get(leaderId);
            if (!creationData) {
                return interaction.followUp({ content: "❌ هذا الطلب ملغى أو انتهت صلاحيته.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            if (!creationData.acceptedUsers.includes(memberId)) {
                creationData.acceptedUsers.push(memberId);
                activeCreations.set(leaderId, creationData);

                await interaction.editReply({ content: "✅ لقد قبلت الدعوة بنجاح!", components: [] }).catch(() => {});

                if (creationData.acceptedUsers.length === 8) {
                    const adminChannel = client.channels.cache.get(config.ADMIN_LOG_CHANNEL_ID);
                    if (adminChannel) {
                        const banner = getGifBanner();
                        const adminEmbed = new EmbedBuilder()
                            .setTitle("👑 طلب إنشاء وتأسيس كلان جديد!")
                            .setDescription(`
قدم العضو <@${leaderId}> طلباً رسمياً لتأسيس كلان: **${creationData.clanName}**
👥 **الأعضاء الـ 7 الموافقون:**
${creationData.acceptedUsers.filter(id => id !== leaderId).map(id => `• <@${id}>`).join("\n")}
`)
                            .setColor("#E74C3C");

                        if (banner) adminEmbed.setImage("attachment://Salvadore_Clans.gif");

                        const adminRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`approve_clan_${leaderId}`)
                                .setLabel("✅ موافقة وتأسيس تلقائي")
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`deny_clan_${leaderId}`)
                                .setLabel("❌ رفض الطلب")
                                .setStyle(ButtonStyle.Danger)
                        );

                        await adminChannel.send({ embeds: [adminEmbed], components: [adminRow], files: banner ? [banner] : [] }).catch(() => {});
                    }
                }
            }
        }

        // 5. اتخاذ القرار من الإدارة
        if (interaction.isButton() && interaction.customId.startsWith("approve_clan_")) {
            await interaction.deferUpdate().catch(() => {});
            const leaderId = interaction.customId.split("_")[2];
            const creationData = activeCreations.get(leaderId);

            if (!creationData) {
                return interaction.followUp({ content: "❌ تعذر العثور على بيانات التأسيس المبدئية.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            const guild = interaction.guild;
            
            const clanRole = await guild.roles.create({
                name: creationData.clanName,
                color: "#FFFFFF"
            }).catch(e => console.error(e));

            const leaderRoleName = `(𝐂𝐥𝐚𝐧・𝙇𝙀𝘼𝘿𝙀𝙍・(${creationData.clanName}))`;
            const leaderRole = await guild.roles.create({
                name: leaderRoleName,
                color: "#FFFFFF"
            }).catch(e => console.error(e));

            if (clanRole && leaderRole) {
                const leaderMember = await guild.members.fetch(leaderId).catch(() => null);
                if (leaderMember) {
                    await leaderMember.roles.add(clanRole.id).catch(() => {});
                    await leaderMember.roles.add(leaderRole.id).catch(() => {});
                }

                for (const memberId of creationData.acceptedUsers) {
                    if (memberId !== leaderId) {
                        const m = await guild.members.fetch(memberId).catch(() => null);
                        if (m) await m.roles.add(clanRole.id).catch(() => {});
                    }
                }

                config.saveNewClan(creationData.clanKey, creationData.clanName, clanRole.id, leaderRole.id);

                activeCreations.delete(leaderId);
                return await interaction.editReply({ content: `✅ تم تفعيل الكلان بنجاح!`, components: [] }).catch(() => {});
            }
        }

        // ===== APPLY BUTTON =====
        if (interaction.isButton() && interaction.customId.startsWith("apply_")) {
            const clanKey = interaction.customId.replace("apply_", "");
            const clans = getCurrentClans();
            const clan = clans[clanKey];

            if (!clan) return interaction.reply({ content: "❌ الكلان غير متواجد حالياً في النظام.", flags: MessageFlags.Ephemeral }).catch(() => {});

            const modal = new ModalBuilder()
                .setCustomId(`modal_${clanKey}`)
                .setTitle(`التقديم لـ ${clan.name}`.substring(0, 45));

            const name = new TextInputBuilder().setCustomId("name").setLabel("Your name").setStyle(TextInputStyle.Short).setRequired(true);
            const age = new TextInputBuilder().setCustomId("age").setLabel("Your age").setStyle(TextInputStyle.Short).setRequired(true);
            const info = new TextInputBuilder().setCustomId("info").setLabel("Tell us about yourself").setStyle(TextInputStyle.Paragraph).setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(name),
                new ActionRowBuilder().addComponents(age),
                new ActionRowBuilder().addComponents(info)
            );

            return await interaction.showModal(modal).catch(() => {});
        }

        // ===== ACCEPT MEMBER =====
        if (interaction.isButton() && interaction.customId.startsWith("accept_")) {
            await interaction.deferUpdate().catch(() => {});
            
            const match = interaction.customId.match(/^accept_(\d+)_(\d+)_(clan_\d+|c_\d+)$/);
            
            if (!match) {
                return interaction.followUp({ content: "❌ Invalid button payload format.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            const [, guildID, userID, clanKey] = match;

            const guild = client.guilds.cache.get(guildID) || await client.guilds.fetch(guildID).catch(() => null);
            if (!guild) return interaction.followUp({ content: "❌ Server not found", flags: MessageFlags.Ephemeral }).catch(() => {});

            const member = await guild.members.fetch(userID).catch(() => null);
            if (!member) return interaction.followUp({ content: "❌ Member not found in server", flags: MessageFlags.Ephemeral }).catch(() => {});

            const clans = getCurrentClans();
            const clan = clans[clanKey];
            
            if (!clan) {
                return interaction.followUp({ content: "❌ Clan config not found in database.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            const clanRole = guild.roles.cache.get(clan.roleID) || await guild.roles.fetch(clan.roleID).catch(() => null);
            if (!clanRole) return interaction.followUp({ content: "❌ Clan role not found on server", flags: MessageFlags.Ephemeral }).catch(() => {});

            await member.roles.add(clanRole.id).catch(err => console.error("Error adding role:", err));
            await member.send(`🎉 تم قبولك في كلان **${clan.name}**!`).catch(() => {});

            return await interaction.editReply({
                content: `✅ Accepted by ${interaction.user.tag}`,
                components: []
            }).catch(() => {});
        }

        // ===== REJECT MEMBER =====
        if (interaction.isButton() && interaction.customId.startsWith("reject_")) {
            await interaction.deferUpdate().catch(() => {});
            
            const match = interaction.customId.match(/^reject_(\d+)_(\d+)_(clan_\d+|c_\d+)$/);
            
            if (!match) {
                return interaction.followUp({ content: "❌ Invalid button payload format.", flags: MessageFlags.Ephemeral }).catch(() => {});
            }

            const [, , userID, clanKey] = match;

            const clans = getCurrentClans();
            const user = await client.users.fetch(userID).catch(() => null);
            if (user) {
                await user.send(`❌ تم رفض طلبك في ${clans[clanKey]?.name || "الكلان"}`).catch(() => {});
            }

            return await interaction.editReply({
                content: `❌ Rejected by ${interaction.user.tag}`,
                components: []
            }).catch(() => {});
        }

        // ===== MODAL SUBMIT (إرسال التقديم لليدر) =====
        if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_")) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const clanKey = interaction.customId.replace("modal_", "");
            const clans = getCurrentClans();
            const clan = clans[clanKey];

            if (!clan) return interaction.editReply("❌ Clan not found in database.").catch(() => {});

            const banner = getGifBanner();
            const embed = new EmbedBuilder()
                .setTitle("📩 New Clan Application")
                .setDescription(`
👤 User: <@${interaction.user.id}>
📝 Name: ${interaction.fields.getTextInputValue("name")}
🎂 Age: ${interaction.fields.getTextInputValue("age")}
📌 Info: ${interaction.fields.getTextInputValue("info")}
🏆 Clan: ${clan.name}
`)
                .setColor("Blue");

            if (banner) embed.setImage("attachment://Salvadore_Clans.gif");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_${interaction.guild.id}_${interaction.user.id}_${clanKey}`)
                    .setLabel("✅ Accept")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`reject_${interaction.guild.id}_${interaction.user.id}_${clanKey}`)
                    .setLabel("❌ Reject")
                    .setStyle(ButtonStyle.Danger)
            );

            const guild = interaction.guild;
            await guild.members.fetch().catch(() => {});
            const leaderRole = guild.roles.cache.get(clan.leaderRoleID);

            if (!leaderRole) {
                return interaction.editReply("❌ رتبة الليدر الخاصة بالكلان غير موجودة بالسيرفر.").catch(() => {});
            }

            const leaders = leaderRole.members;
            if (!leaders || leaders.size === 0) {
                return interaction.editReply("❌ لا يوجد أي قائد يمتلك رتبة الليدر حالياً للتوصل بالطلب.").catch(() => {});
            }

            for (const [, leader] of leaders) {
                await leader.send({
                    embeds: [embed],
                    components: [row],
                    files: banner ? [banner] : []
                }).catch(() => {});
            }

            await interaction.editReply("✅ Application sent to leader").catch(() => {});
        }

    } catch (err) {
        console.log("Error in interactionCreate event:", err);
    }
});

if (!verifyXPVolumeBeforeBotStart()) {
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);