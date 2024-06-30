/* 
	*	Source By Rasya R. - @chocoopys
	*	My Github: github.com/Rasya25
	*	My Instagram: @r.rdtyptr
	*	My Tiktok: @r.rdtyptrr
	*	Don't sell this
	*/

import 'dotenv/config';

import makeWASocket, { delay, useMultiFileAuthState, fetchLatestWaWebVersion, makeInMemoryStore, jidNormalizedUser, PHONENUMBER_MCC, DisconnectReason, Browsers, makeCacheableSignalKeyStore } from '@chocoopy/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import os from 'os';
import cfonts from 'cfonts';
//import chalk from 'chalk';
import { exec } from 'child_process';

import treeKill from './lib/tree-kill.js';
import serialize, { Client } from './lib/serialize.js';
import { formatSize, parseFileSize, sendTelegram } from './lib/function.js';

const logger = pino({ timestamp: () => `,"time":"${new Date().toJSON()}"` }).child({ class: 'sockk' });
logger.level = 'fatal';

const usePairingCode = process.env.PAIRING_NUMBER;
const store = makeInMemoryStore({ logger });

if (process.env.WRITE_STORE === 'true') store.readFromFile(`./${process.env.SESSION_NAME}/store.json`);
// check available file
const pathContacts = `./${process.env.SESSION_NAME}/contacts.json`;
const pathMetadata = `./${process.env.SESSION_NAME}/groupMetadata.json`;

const startSock = async () => {
	const { state, saveCreds } = await useMultiFileAuthState(`./${process.env.SESSION_NAME}`);
	const { version, isLatest } = await fetchLatestWaWebVersion();

    cfonts.say("Rasya R.", {
    colors: ["green"],
   font: 'tiny',
  align: 'left',
});
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

	const sockk = makeWASocket.default({
		version,
		logger,
		printQRInTerminal: !usePairingCode,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		browser: Browsers.macOS("Safari"),
		markOnlineOnConnect: false,
		generateHighQualityLinkPreview: true,
		syncFullHistory: true,
		retryRequestDelayMs: 10,
		transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 10 },
		defaultQueryTimeoutMs: undefined,
		maxMsgRetryCount: 15,
		appStateMacVerification: {
			patch: true,
			snapshot: true,
		},
		getMessage: async key => {
			const jid = jidNormalizedUser(key.remoteJid);
			const msg = await store.loadMessage(jid, key.id);

			return msg?.message || '';
		},
		shouldSyncHistoryMessage: msg => {
			console.log(`\x1b[32mMemuat Chat [${msg.progress}%]\x1b[39m`);
			return !!msg.syncType;
		},
	});

	store.bind(sockk.ev);
	await Client({ sockk, store });

	// login dengan pairing
	if (usePairingCode && !sockk.authState.creds.registered) {
		let phoneNumber = usePairingCode.replace(/[^0-9]/g, '');

		if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) throw "Start with your country's WhatsApp code, Example : 62xxx";

		await delay(3000);
		let code = await sockk.requestPairingCode(phoneNumber);
		console.log(`\x1b[32m${code?.match(/.{1,4}/g)?.join('-') || code}\x1b[39m`);
	}

	// ngewei info, restart or close
	sockk.ev.on('connection.update', async update => {
		const {
            lastDisconnect,
            connection
        } = update
        if (connection) {
            console.info(`Connection Status : ${connection}`)
        }


        if (connection === "close") {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode

            switch (reason) {
                case DisconnectReason.badSession:
                    console.info(`Bad Session File, Restart Required`)
                    startSock()
                    break
                case DisconnectReason.connectionClosed:
                    console.info("Connection Closed, Restart Required")
                    startSock()
                    break
                case DisconnectReason.connectionLost:
                    console.info("Connection Lost from Server, Reconnecting...")
                    startSock()
                    break
                case DisconnectReason.connectionReplaced:
                    console.info("Connection Replaced, Restart Required")
                    startSock()
                    break
                case DisconnectReason.restartRequired:
                    console.info("Restart Required, Restarting...")
                    startSock()
                    break
                case DisconnectReason.loggedOut:
                    console.error("Device has Logged Out, please rescan again...")
                    sockk.end()
                    fs.rmSync(`./session`, {
                        recursive: true,
                        force: true
                    })
                    exec("npm run stop:pm2", (err) => {
                        if (err) return treeKill(process.pid)
                    })
                    break
                case DisconnectReason.multideviceMismatch:
                    console.error("Need Multi Device Version, please update and rescan again...")
                    sockk.end()
                    fs.rmSync(`./session`, {
                        recursive: true,
                        force: true
                    })
                    exec("npm run stop:pm2", (err) => {
                        if (err) return treeKill(process.pid)
                    })
                    break
                default:
                    console.log("I don't understand this issue")
                    startSock()
            }
        }

        if (connection === "open") {
        	sockk.sendMessage(jidNormalizedUser(sockk.user.id), { text: `${sockk.user?.name} has Connected...` });
            console.clear();
            cfonts.say("Connected successfully", {
                font: "tiny",
                align: "center",
                colors: ["red"]
            });
        }
    });

	// write session kang
	sockk.ev.on('creds.update', saveCreds);

	// contacts
	if (fs.existsSync(pathContacts)) {
		store.contacts = JSON.parse(fs.readFileSync(pathContacts, 'utf-8'));
	} else {
		fs.writeFileSync(pathContacts, JSON.stringify({}));
	}
	// group metadata
	if (fs.existsSync(pathMetadata)) {
		store.groupMetadata = JSON.parse(fs.readFileSync(pathMetadata, 'utf-8'));
	} else {
		fs.writeFileSync(pathMetadata, JSON.stringify({}));
	}

	// add contacts update to store
	sockk.ev.on('contacts.update', update => {
		for (let contact of update) {
			let id = jidNormalizedUser(contact.id);
			if (store && store.contacts) store.contacts[id] = { ...(store.contacts?.[id] || {}), ...(contact || {}) };
		}
	});

	// add contacts upsert to store
	sockk.ev.on('contacts.upsert', update => {
		for (let contact of update) {
			let id = jidNormalizedUser(contact.id);
			if (store && store.contacts) store.contacts[id] = { ...(contact || {}), isContact: true };
		}
	});

	// nambah perubahan grup ke store
	sockk.ev.on('groups.update', updates => {
		for (const update of updates) {
			const id = update.id;
			if (store.groupMetadata[id]) {
				store.groupMetadata[id] = { ...(store.groupMetadata[id] || {}), ...(update || {}) };
			}
		}
	});

	// merubah status member
	sockk.ev.on('group-participants.update', ({ id, participants, action }) => {
		const metadata = store.groupMetadata[id];
		if (metadata) {
			switch (action) {
				case 'add':
				case 'revoked_membership_requests':
					metadata.participants.push(...participants.map(id => ({ id: jidNormalizedUser(id), admin: null })));
					break;
				case 'demote':
				case 'promote':
					for (const participant of metadata.participants) {
						let id = jidNormalizedUser(participant.id);
						if (participants.includes(id)) {
							participant.admin = action === 'promote' ? 'admin' : null;
						}
					}
					break;
				case 'remove':
					metadata.participants = metadata.participants.filter(p => !participants.includes(jidNormalizedUser(p.id)));
					break;
			}
		}
	});

	// bagian pepmbaca status ono ng kene
	sockk.ev.on('messages.upsert', async ({ messages }) => {
		if (!messages[0].message) return;
		let m = await serialize(sockk, messages[0], store);

		// nambah semua metadata ke store
		if (store.groupMetadata && Object.keys(store.groupMetadata).length === 0) store.groupMetadata = await sockk.groupFetchAllParticipating();

		// untuk membaca pesan status
		if (m.key && !m.key.fromMe && m.key.remoteJid === 'status@broadcast') {
			if (m.type === 'protocolMessage' && m.message.protocolMessage.type === 0) return;
			await sockk.readMessages([m.key]);
			let id = m.key.participant;
			let name = sockk.getName(id);
			if (process.env.TELEGRAM_TOKEN && process.env.ID_TELEGRAM) {
				if (m.isMedia) {
					let media = await sockk.downloadMediaMessage(m);
					let caption = `Dari : https://wa.me/${id.split('@')[0]} (${name})${m.body ? `\n\nCaption : ${m.body}` : ''}`;
					await sendTelegram(process.env.ID_TELEGRAM, media, { type: /audio/.test(m.msg.mimetype) ? 'document' : '', caption });
				} else await sendTelegram(process.env.ID_TELEGRAM, `Dari : https://wa.me/${id.split('@')[0]} (${name})\n\nCaption : ${m.body}`);
			}
		}

		// status self apa publik
		if (process.env.SELF === 'true' && !m.isOwner) return;

		// kanggo kes
		await (await import(`./message.js?v=${Date.now()}`)).default(sockk, store, m);
	});

	setInterval(async () => {
		// write contacts and metadata
		if (store.groupMetadata) fs.writeFileSync(pathMetadata, JSON.stringify(store.groupMetadata));
		if (store.contacts) fs.writeFileSync(pathContacts, JSON.stringify(store.contacts));

		// write store
		if (process.env.WRITE_STORE === 'true') store.writeToFile(`./${process.env.SESSION_NAME}/store.json`);

		// untuk auto restart ketika RAM sisa 300MB
		const memoryUsage = os.totalmem() - os.freemem();

		if (memoryUsage > os.totalmem() - parseFileSize(process.env.AUTO_RESTART, false)) {
			await sockk.sendMessage(jidNormalizedUser(sockk.user.id), { text: `penggunaan RAM mencapai *${formatSize(memoryUsage)}* waktunya merestart...` }, { ephemeralExpiration: 24 * 60 * 60 * 1000 });
			exec('npm run restart:pm2', err => {
				if (err) return process.send('reset');
			});
		}
	}, 10 * 1000); // tiap 10 detik
	
	  /** auto clear smpah session*/
	/*if (!fs.readdir("./session", async function (err, files) {
                    if (err) {
                        console.error(err)
                    }}));
  setInterval(() => {
                    let file = await files.filter(item => item.startsWith('pre-key') || item.startsWith('sender-key') || item.startsWith('session-') || item.startsWith('app-state'));
                    await file.forEach(function (a) {
                        fs.unlinkSync(`./session/${a}`)
                    });
  }, 30 * 1000); // every 30 second
*/
	process.on('uncaughtException', console.error);
	process.on('unhandledRejection', console.error);
};

startSock();
