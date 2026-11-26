import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import mongoose from 'mongoose';

function findMongodPath() {
  const defaultPath = 'C:\\Program Files\\MongoDB\\Server\\8.3\\bin\\mongod.exe';
  if (fs.existsSync(defaultPath)) return defaultPath;
  return 'mongod';
}

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function checkPortOpen(port, timeoutMs = 15000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(500);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - startTime >= timeoutMs) {
          reject(new Error(`Timed out waiting for MongoDB on port ${port}`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - startTime >= timeoutMs) {
          reject(new Error(`Timed out waiting for MongoDB on port ${port}`));
        } else {
          setTimeout(tryConnect, 200);
        }
      });

      socket.connect(port, '127.0.0.1');
    }

    tryConnect();
  });
}

export class TestMongoServer {
  constructor() {
    this.port = null;
    this.process = null;
    this.dbPath = null;
    this.uri = null;
  }

  async start() {
    this.port = await getFreePort();
    this.dbPath = fs.mkdtempSync(path.join(os.tmpdir(), `nexa-mongo-${this.port}-`));
    this.uri = `mongodb://127.0.0.1:${this.port}/nexa_test_${this.port}`;

    const mongodExe = findMongodPath();
    this.process = spawn(
      mongodExe,
      [
        '--dbpath',
        this.dbPath,
        '--port',
        this.port.toString(),
        '--bind_ip',
        '127.0.0.1',
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
      }
    );

    this.process.stderr.on('data', (d) => {
      const msg = d.toString();
      if (!msg.includes('connection accepted') && !msg.includes('Connection ended')) {
        // console.error(`[Mongo ${this.port}]:`, msg);
      }
    });

    await checkPortOpen(this.port);

    await mongoose.connect(this.uri, {
      serverSelectionTimeoutMS: 10000,
    });

    return { port: this.port, uri: this.uri };
  }

  async stop() {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    if (this.process && !this.process.killed) {
      this.process.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 400));
      try {
        this.process.kill('SIGKILL');
      } catch (_) {}
      this.process = null;
    }

    if (this.dbPath && fs.existsSync(this.dbPath)) {
      try {
        fs.rmSync(this.dbPath, { recursive: true, force: true });
      } catch (_) {}
      this.dbPath = null;
    }
  }
}

// Backward-compatible module singleton
let defaultInstance = null;

export async function startTestMongo(port) {
  defaultInstance = new TestMongoServer();
  return defaultInstance.start();
}

export async function stopTestMongo() {
  if (defaultInstance) {
    await defaultInstance.stop();
    defaultInstance = null;
  }
}

export class TestMongoReplicaSet {
  constructor() {
    this.port = null;
    this.process = null;
    this.dbPath = null;
    this.uri = null;
  }

  async start() {
    this.port = await getFreePort();
    this.dbPath = fs.mkdtempSync(path.join(os.tmpdir(), `nexa-mongo-rs-${this.port}-`));
    const directUri = `mongodb://127.0.0.1:${this.port}/nexa_rs_test_${this.port}`;
    this.uri = `${directUri}?replicaSet=rs0&directConnection=true`;

    const mongodExe = findMongodPath();
    this.process = spawn(
      mongodExe,
      [
        '--replSet',
        'rs0',
        '--dbpath',
        this.dbPath,
        '--port',
        this.port.toString(),
        '--bind_ip',
        '127.0.0.1',
      ],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
      }
    );

    await checkPortOpen(this.port);

    await mongoose.connect(directUri, {
      directConnection: true,
      serverSelectionTimeoutMS: 10000,
    });

    await mongoose.connection.db.admin().command({
      replSetInitiate: {
        _id: 'rs0',
        members: [{ _id: 0, host: `127.0.0.1:${this.port}` }],
      },
    });

    const deadline = Date.now() + 20000;
    let isPrimary = false;
    while (Date.now() < deadline) {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      if (hello.isWritablePrimary) {
        isPrimary = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!isPrimary) {
      throw new Error(`Replica set rs0 on port ${this.port} did not elect a primary in time`);
    }

    await mongoose.disconnect();
    await mongoose.connect(this.uri, {
      serverSelectionTimeoutMS: 10000,
    });

    return {
      port: this.port,
      uri: this.uri,
      client: mongoose.connection.getClient(),
    };
  }

  async stop() {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    if (this.process && !this.process.killed) {
      this.process.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 400));
      try {
        this.process.kill('SIGKILL');
      } catch (_) {}
      this.process = null;
    }

    if (this.dbPath && fs.existsSync(this.dbPath)) {
      try {
        fs.rmSync(this.dbPath, { recursive: true, force: true });
      } catch (_) {}
      this.dbPath = null;
    }
  }
}
