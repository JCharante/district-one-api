const MongoClient = require('mongodb').MongoClient;
const ObjectId = require('mongodb').ObjectID;
const atlasURL = process.env.ATLAS_URL;

async function getConnectedClient() {
    const client = await new MongoClient(atlasURL, { useNewUrlParser: true });
    await client.connect();
    return client;
}

function randomStr(len, arr) {
    let ans = '';
    for (var i = len; i > 0; i--) {
        ans +=
            arr[Math.floor(Math.random() * arr.length)];
    }
    return ans;
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
    createSession: async function(dialCode, phoneNumber, ip) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const sessionsCollection = db.collection('sessions');
        const expiresAt = new Date(new Date().getTime() + (14 * 24 * 3600 * 1000));
        const ret = await sessionsCollection.insertOne({ ip, dialCode, phoneNumber, expiresAt })
        await client.close();
        console.log("Created session for ", dialCode, phoneNumber, "from ", ip);
        return { sessionKey: ret.insertedId.toString() };
    },
    sessionKeyIsValid: async function(sessionKey_string) {
        if (sessionKey_string.length !== 12 && sessionKey_string.length !== 24) {
            return false;
        }
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const sessionsCollection = db.collection('sessions');
        const ret = await sessionsCollection.findOne({ _id: ObjectId(sessionKey_string) });
        await client.close();
        if (ret) {
            return { valid: true, dialCode: ret.dialCode, phoneNumber: ret.phoneNumber }
        } else {
            return { valid: false }
        }
    },
    dailyLoginReward: async function(dialCode, phoneNumber) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const usersCollection = db.collection('users');
        const ret = await usersCollection.findOne({ dialCode, phoneNumber });
        if (!ret) {
            await client.close();
            return { gaveReward: false };
        }
        let shouldGiveReward = false;
        let lastLoginRewardTime = ret.lastLoginRewardTime;
        if (lastLoginRewardTime === undefined) {
            shouldGiveReward = true;
        } else {
            // calculate if it's been six hours
            lastLoginRewardTime.setHours(lastLoginRewardTime.getHours() + 6);
            if (new Date() > lastLoginRewardTime) {
                shouldGiveReward = true;
            }
        }
        if (shouldGiveReward) {
            await usersCollection.updateOne({ dialCode, phoneNumber }, { '$set': { lastLoginRewardTime: new Date() }, '$inc': { balance: 5 } });
        }
        await client.close();
        return { gaveReward: shouldGiveReward }
    },
    authAbuseIsDetected: async function(ip, dialCode, phoneNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const col = db.collection('authRequests');
        const fiveMinutesAgo = new Date();
        fiveMinutesAgo.setMinutes(new Date().getMinutes() - 5);
        const requestsFromIP = await col.find({
            time: {
                '$gte': fiveMinutesAgo,
            },
            ip
        }).toArray();
        const requestsForNumber = await col.find({
            dialCode,
            phoneNumber,
            time: {
                '$gte': fiveMinutesAgo,
            },
        }).toArray();
        console.log('Requests from IP: ', ip, requestsFromIP.length, ' Requests for Phone +', dialCode, phoneNumber, requestsForNumber.length);
        return requestsFromIP.length > 4 || requestsForNumber.length > 3;
    },
    logSendSMS: async function(ip, dialCode, phoneNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const col = db.collection('authRequests');
        const time = new Date();
        const ret = await col.insertOne({
            ip,
            dialCode,
            phoneNumber,
            time
        });
        await client.close();
        return;
    },
    likeTeam: async function(dialCode, phoneNumber, teamNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const teamLikesCollection = db.collection('teamLikes');
        let ret = await teamLikesCollection.findOne({ dialCode, phoneNumber, teamNumber });
        if (ret === null) {
            ret = await teamLikesCollection.insertOne({ dialCode, phoneNumber, teamNumber });
        }
        await client.close();
        return;
    },
    likeEvent: async function(dialCode, phoneNumber, eventCode) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const eventLikesCollection = db.collection('eventLikes');
        let ret = await eventLikesCollection.findOne({ dialCode, phoneNumber, eventCode });
        if (ret === null) {
            ret = await eventLikesCollection.insertOne({ dialCode, phoneNumber, eventCode });
        }
        await client.close();
        return;
    },
    unlikeTeam: async function(dialCode, phoneNumber, teamNumber) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const teamLikesCollection = db.collection('teamLikes');
        let ret = await teamLikesCollection.deleteOne({ dialCode, phoneNumber, teamNumber });
        await client.close();
        return;
    },
    unlikeEvent: async function(dialCode, phoneNumber, eventCode) {
        const client = await getConnectedClient()
        const db = client.db('district-one');
        const eventLikesCollection = db.collection('eventLikes');
        let ret = await eventLikesCollection.deleteOne({ dialCode, phoneNumber, eventCode });
        await client.close();
        return;
    },
    getTeamAndEventLikes: async function(dialCode, phoneNumber) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const teamLikesCollection = db.collection('teamLikes');
        const eventLikesCollection = db.collection('eventLikes');
        let teamLikes = (await teamLikesCollection
            .find({ dialCode, phoneNumber })
            .toArray())
            .map((document) => { return document.teamNumber });
        let eventLikes = (await eventLikesCollection
            .find({ dialCode, phoneNumber })
            .toArray())
            .map((document) => { return document.eventCode });
        await client.close();
        return { teamLikes, eventLikes };
    },
    doesUserExist: async function(dialCode, phoneNumber) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const col = db.collection('users');
        const ret = await col.findOne({ dialCode, phoneNumber });
        await client.close();
        return !!ret;
    },
    isReferralCodeUnique: async function(code) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const col = db.collection('users');
        const ret = await col.findOne({ referralCode: code });
        await client.close();
        return !ret;
    },
    createUser: async function(dialCode, phoneNumber, referrerCode) {
        if (referrerCode === undefined) {
            referrerCode = '';
        }
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const col = db.collection('users');
        // generate a six-digit referrer code for them
        let referralCode = '';
        while (referralCode.length === 0 || !this.isReferralCodeUnique(referralCode)) {
            referralCode = randomStr(6, ['a', 'e', 'i', 'o', 'u', 'y', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
        }
        // insert into DB
        const ret = await col.insertOne({ dialCode, phoneNumber, referrerCode, referralCode });
        console.log("Created account for ", dialCode, phoneNumber, "referred by", referrerCode, "given referral code", referralCode);
        // find who referred them if anyone
        if (referrerCode.length > 0) {
            const referrer = await col.findOne({ referralCode: referrerCode });
            if (referrer) {
                // give them points for the referral
                await col.updateMany({ referralCode: { '$in': [referrerCode, referralCode] } }, { '$inc': { balance: 5 } });
                console.log("Credited users for the referral");
            }
        }
        await client.close();
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
    },
    getAvatarsForTeams: async function(list_of_team_number) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const teamsCollection = db.collection('teams');
        const teams = await teamsCollection.find({ team_number: { '$in': list_of_team_number }}).toArray();
        const ret = {}
        teams.forEach((teamDoc) => {
            if ('avatar' in teamDoc) {
                ret[teamDoc.team_number] = teamDoc.avatar;
            }
        })
        await client.close();
        return ret;
    },
    getTeamsForTeamList: async function() {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const teamsCollection = db.collection('teams');
        const ret = await teamsCollection.aggregate([
            {
                '$lookup': {
                    'from': 'teamLikes',
                    'localField': 'team_number',
                    'foreignField': 'teamNumber',
                    'as': 'likedBy'
                }
            }, {
                '$group': {
                    '_id': null,
                    'teams': {
                        '$push': {
                            'likes': {
                                '$size': '$likedBy'
                            },
                            'team_number': '$team_number',
                            'nickname': '$nickname',
                            'ranking': '$ranking'
                        }
                    }
                }
            }
        ]).toArray();
        await client.close();
        return ret[0].teams;
        
    },
    createEventBet: async function(dialCode, phoneNumber, eventCode, teamNumber, betType) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const eventBetsCollection = db.collection('eventBets');
        // verify event exists
        const eventsCollection = db.collection('events');
        const eventDoc = await eventsCollection.findOne({ key: eventCode });
        if (eventDoc === nul) {
            await client.close();
            throw Error("This event does not exist.");
        }
        // verify team is at event
        if (!eventDoc.team_numbers.includes(teamNumber)) {
            await client.close();
            throw Error("This team is not at this event.");
        }
        // verify user is not at capacity for this type of bet
        const settingsCollection = db.collection('settings');
        const settings = settingsCollection.findOne({ environment: "2020" });
        if (betType === "winner") {
            const preExistingBets = eventBetsCollection.find({ dialCode, phoneNumber, eventCode, betType}).toArray();
            if (preExistingBets.length > settings.maxWinnerBets) {
                await client.close();
                throw Error("You have reached the capacity for this type of bet at this event.");
            }
        }
        // insert bet
        await eventBetsCollection.insertOne({ dialCode, phoneNumber, eventCode, betType, teamNumber });
    },
    getEventInfo: async function(eventCode) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const eventsCollection = db.collection('events');
        const ret = await eventsCollection.findOne({ key: eventCode });
        if (ret === null) {
            await client.close();
            return {};
        }
        // get relevant bets
        const eventBetsCollection = db.collection('eventBets');
        const bets = (await eventBetsCollection.find({ eventCode }).toArray()).map((bet) => {
            return {
                betType: bet.betType,
                teamNumber: bet.teamNumber
            }
        })
        ret.bets = bets;
        await client.close();
        return ret;
    },
    getTeamInfo: async function(team_number) {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const teamDoc = await db.collection('teams').findOne({ team_number });
        const matchesArray = await db.collection('matches').find({ team_keys_int: team_number }).toArray();
        const matchRankingsArray = await db.collection('match_rankings').find({ team_keys_int: team_number }).toArray();
        // merge arrays
        const matches = matchesArray.map((matches_doc) => {
            // see if in matchRankings
            const search_matches = matchRankingsArray.filter((mR) => mR.key === matches_doc.key);
            if (search_matches.length > 0) {
                matches_doc.matchRankings = search_matches[0]
            }
            return matches_doc;
        })
        await client.close();
        return {
            ...teamDoc,
            matches
        }
    },
    getShortEventInfo: async function() {
        const client = await getConnectedClient();
        const db = client.db('district-one');
        const settingsCollection = db.collection('settings');
        const ret = await settingsCollection.aggregate([
            {
                '$match': {
                    'environment': '2020'
                }
            }, {
                '$unwind': {
                    'path': '$countedEvents',
                    'preserveNullAndEmptyArrays': true
                }
            }, {
                '$project': {
                    '_id': null,
                    'eventCode': '$countedEvents'
                }
            }, {
                '$lookup': {
                    'from': 'events',
                    'localField': 'eventCode',
                    'foreignField': 'key',
                    'as': 'eventInfo'
                }
            }, {
                '$unwind': {
                    'path': '$eventInfo',
                    'preserveNullAndEmptyArrays': true
                }
            }, {
                '$replaceRoot': {
                    'newRoot': '$eventInfo'
                }
            }, {
                '$lookup': {
                    'from': 'eventLikes',
                    'localField': 'key',
                    'foreignField': 'eventCode',
                    'as': 'likedBy'
                }
            }, {
                '$group': {
                    '_id': null,
                    'events': {
                        '$push': {
                            'likes': {
                                '$size': '$likedBy'
                            },
                            'eventCode': '$key',
                            'end_date': '$end_date',
                            'start_date': '$start_date',
                            'short_name': '$short_name',
                            'week': '$week',
                            'name': '$name',
                            'district': '$district',
                            'event_type_string': '$event_type_string'
                        }
                    }
                }
            }
        ]).toArray();
        await client.close();
        return ret[0].events;
        
    },
}
