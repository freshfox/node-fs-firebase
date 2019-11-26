import * as admin from 'firebase-admin';
import {inject, injectable} from 'inversify';
import * as stream from 'stream';
import {GetSignedUrlConfig} from '@google-cloud/storage';
import {awaitWriteFinish, GetUrlOptions, IOnlineFilesystem, Stats} from 'node-fs-local';
import * as uuid from 'uuid/v4';

export interface FirebaseFileMetaData {
	kind?: string,
	id?: string;
	name?: string;
	contentType?: string;
	size?: string;
	timeCreated?: string;
	updated?: string;
	metadata: {
		[key: string]: string | number;
		firebaseStorageDownloadTokens?: string
	}
}

export const FirebaseStorage = Symbol('FirebaseStorage');

@injectable()
export class FirebaseFilesystem implements IOnlineFilesystem<FirebaseFileMetaData> {

	constructor(@inject(FirebaseStorage) private storage: admin.storage.Storage) {
	}

	createWriteStream(file: string, opts?: any): stream.Writable {
		return this.storage.bucket().file(file).createWriteStream({
			...opts,
			resumable: false
		});
	}

	createReadStream(path: string, opts?: any): stream.Readable {
		return this.storage.bucket().file(path).createReadStream(opts);
	}

	async exists(path: string): Promise<boolean> {
		return (await this.storage.bucket().file(path).exists())[0];
	}

	mkdir(path: string): Promise<void> {
		return Promise.resolve();
	}

	async readFile(path: string, encoding?: string): Promise<string | Buffer> {
		const data = await this.storage.bucket().file(path).download();
		const buffer = data[0];
		if (encoding === 'utf8') {
			return buffer.toString(encoding);
		}
		return buffer;
	}

	unlink(path: string): Promise<any> {
		return this.storage.bucket().file(path).delete();
	}

	writeStreamToFile(path: string, stream: stream.Readable, options?: any): Promise<any> {
		const writeStream = this.storage.bucket().file(path).createWriteStream({
			...options,
			resumable: false,
		});
		stream.pipe(writeStream);
		return awaitWriteFinish(writeStream);
	}

	async readDir(path: string): Promise<string[]> {
		path = path[path.length - 1] === '/' ? path : `${path}/`;
		const resp = await this.storage.bucket().getFiles({
			prefix: path
		});
		const files = resp[0];
		return files.map((file) => {
			const name = file.metadata.name;
			return name.substr(path.length);
		}).filter(s => s);
	}

	async getUploadUrl(path: string, validUntil: Date, opts?: Partial<GetSignedUrlConfig>) {
		opts = opts || {};
		const resp = await this.storage.bucket().file(path).getSignedUrl(<GetSignedUrlConfig>{
			version: 'v4',
			contentType: 'video/mp4',
			action: 'write',
			expires: validUntil,
		});
		return resp[0];
	}

	async getDownloadUrl(path: string, validUntil: Date, options?: GetUrlOptions): Promise<string> {
		const dateStr = validUntil.toISOString().substring(0, 10);
		const resp = await this.storage.bucket().file(path).getSignedUrl({
			action: 'read',
			expires: dateStr,
			contentType: options && options.contentType ? options.contentType : null
		});
		return resp[0];
	}

	async lstat(path: string): Promise<Stats> {
		const metadata = await this.getMetadata(path);
		const size = parseInt(metadata.size, 10) || 0;
		return {size};
	}

	async getMetadata(path: string): Promise<FirebaseFileMetaData> {
		const meta = await this.storage.bucket().file(path).getMetadata();
		return meta[0];
	}

	async setMetadata(path: string, metadata: FirebaseFileMetaData): Promise<FirebaseFileMetaData> {
		const res = await this.storage.bucket().file(path).setMetadata(metadata, {});
		return res[0];
	}

	static createUrl(bucket: string, path: string, token: string){
		`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
	}

	static generateTokenAndUrl(bucket: string, path: string) {
		const token = uuid();
		return {
			token,
			url: this.createUrl(bucket, path, token)
		}
	}

}
