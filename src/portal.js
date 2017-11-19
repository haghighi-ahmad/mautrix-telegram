// mautrix-telegram - A Matrix-Telegram puppeting bridge
// Copyright (C) 2017 Tulir Asokan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
const TelegramPeer = require("./telegram-peer")

class Portal {
	constructor(app, roomID, peer) {
		this.app = app
		this.type = "portal"

		this.roomID = roomID
		this.peer = peer
		this.accessHashes = new Map()
	}

	get id() {
		return this.peer.id
	}

	get receiverID() {
		return this.peer.receiverID
	}

	static fromEntry(app, entry) {
		if (entry.type !== "portal") {
			throw new Error("MatrixUser can only be created from entry type \"portal\"")
		}

		const portal = new Portal(app, entry.data.roomID, TelegramPeer.fromSubentry(entry.data.peer))
		if (portal.peer.type === "channel") {
			portal.accessHashes = new Map(entry.data.accessHashes)
		}
		return portal
	}

	async syncTelegramUsers(telegramPOV, users) {
		if (!users) {
			if (! await this.loadAccessHash(telegramPOV)) {
				return false
			}
			const data = await this.peer.getInfo(telegramPOV)
			users = data.users
		}
		for (const userData of users) {
			const user = await this.app.getTelegramUser(userData.id)
			await user.updateInfo(telegramPOV, userData, true)
			await user.intent.join(this.roomID)
		}
		return true
	}

	loadAccessHash(telegramPOV) {
		return this.peer.loadAccessHash(this.app, telegramPOV, {portal: this})
	}

	async handleTelegramEvent(sender, evt) {
		// TODO handle other content types
		sender.sendText(this.roomID, evt.text)
	}

	async handleMatrixEvent(sender, evt) {
		switch(evt.content.msgtype) {
			case "m.notice":
			case "m.text":
				await this.loadAccessHash(sender.telegramPuppet)
				sender.telegramPuppet.sendMessage(this.peer, evt.content.body)
				break
			default:
				console.log("Unhandled event:", evt)
		}
	}

	isMatrixRoomCreated() {
		return !!this.roomID
	}

	async createMatrixRoom(telegramPOV) {
		if (this.roomID) {
			return this.roomID
		}

		try {
			if (! await this.loadAccessHash(telegramPOV)) {
				return undefined
			}

			let title, info, users
			if (this.peer.type !== "user") {
				({info, users} = await this.peer.getInfo(telegramPOV))
				title = info.title
			} else {
				({info} = await this.peer.getInfo(telegramPOV))
				users = await this.app.getTelegramUser(info.id)
				await users.updateInfo(telegramPOV, info)
				title = users.getDisplayName()
			}

			const room = await this.app.botIntent.createRoom({
				options: {
					name: title,
					visibility: "private",
				}
			})

			this.roomID = room.room_id
			this.app.portalsByRoomID.set(this.roomID, this)
			await this.save()
			if (this.peer.type !== "user") {
				await this.syncTelegramUsers(telegramPOV, users)
			} else {
				await users.intent.join(this.roomID)
			}
			return this.roomID
		} catch (err) {
			console.error(err)
			console.error(err.stack)
			return undefined
		}
	}

	updateInfo(telegramPOV, dialog) {
		let changed = false
		if (this.peer.type === "channel") {
			if (telegramPOV && this.accessHashes.get(telegramPOV.userID) !== dialog.access_hash) {
				this.accessHashes.set(telegramPOV.userID, dialog.access_hash)
				changed = true
			}
		}
		changed = this.peer.updateInfo(dialog) || changed
		if (changed) {
			this.save()
		}
		return changed
	}

	toEntry() {
		return {
			type: this.type,
			id: this.id,
			receiverID: this.receiverID,
			data: {
				roomID: this.roomID,
				peer: this.peer.toSubentry(),
				accessHashes: this.peer.type === "channel"
					? Array.from(this.accessHashes)
					: undefined,
			}
		}
	}

	save() {
		return this.app.putRoom(this)
	}
}

module.exports = Portal