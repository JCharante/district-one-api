const MongoClient = require('mongodb').MongoClient;
const ObjectId = require('mongodb').ObjectID;
const atlasURL = process.env.ATLAS_URL;

async function getConnectedClient() {
    const client = await new MongoClient(atlasURL, { useNewUrlParser: true });
    await client.connect();
    return client;
}

module.exports = {
    getUserFromSessionKey: async function(sessionKey) {
        const client = await new MongoClient(atlasURL, { useNewUrlParser: true });
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db('your-final-grade');
        const sessionsCollection = db.collection('sessions');
        
        const sessionDocument = await sessionsCollection.findOne({ _id: ObjectId(sessionKey) });
        if (!sessionDocument) {
            throw new Error('Invalid Session Key');
        }
        
        const usersCollection = db.collection('users');
        const userDocument = await usersCollection.findOne({ _id: sessionDocument.user });
        if (!userDocument) {
            throw new Error('User Does Not Exist');
        }
        await client.close();
        return userDocument;
    },
    createUser: async function(username, password, displayName) {
        username = username.toLowerCase();
        const client = await new MongoClient(atlasURL, { useNewUrlParser: true });
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db('your-final-grade');
        const usersCollection = db.collection('users');
        // verify username is unique
        let doc = await usersCollection.findOne({ username });
        if (doc) {
            throw new Error('Username taken');
        }
        await usersCollection.insertOne({
            username,
            displayName,
            dataStore: {},
        })
        const userDocument = await usersCollection.findOne({ username, displayName });
        await client.close();
        return userDocument;
    },
    createSession: async function(userId) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const sessionsCollection = db.collection('sessions');
        const expiresAt = new Date(new Date().getTime() + (14 * 24 * 3600 * 1000));
        const ret = await sessionsCollection.insertOne({ userId, expiresAt })
        await client.close();
        return { sessionKey: ret.insertedId.toString() };
    },
    setUserDataStore: async function(userObjectId, newDataStore) {
        const client = await getConnectedClient();
        const db = client.db('your-final-grade');
        const usersCollection = db.collection('users');
        await usersCollection.updateOne(
            {
                _id: userObjectId,
            },
            {
                '$set': {
                    dataStore: newDataStore
                }
            }
        )
        await client.close();
    }
}
