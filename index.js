'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const MongoClient = require('mongodb').MongoClient;
require('dotenv').config();
const atlasUrl = process.env.ATLAS_URL;

const mongoHandler = require('./mongo');

const app = express();
const twilio = require('twilio');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_KEY)

app.use(bodyParser.json());

exports.handler = (event, context, callback) => {
    handleRequest(event, context, callback);
};

async function handleRequest(req, res, spare) {
    res.set({
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    const ip = req.headers['x-appengine-user-ip'] || req.header['x-forwarded-for'] || req.connection.remoteAddress;
    if (req.method === 'OPTIONS') {
        console.log(`HTTP ${req.method} / from ${ip}`)
        res.status(200).send();
        return;
    } else {
        console.log(`HTTP ${req.method} / from ${ip} | ${req.body.requestType}`)
    }
    let body = req.body;
    // console.log('Received request %o', body);
    
    let requestType = ""
    requestType = body.requestType || requestType;
    let userDoc;
    
    /*
    // enforce a session key for non-login, non-signup, or non-ping requests
    if (requestType !== "ping" && requestType !== "sendSMS" && requestType !== "checkCode" && requestType !== 'checkSessionKey') {
        const sessionKey = body.sessionKey;
        if (!sessionKey) {
            res.status(403).send('You must include a session key in your request');
            return;
        }
        // there is a session key
        // get user for session key
        try {
            userDoc = await mongoHandler.getUserFromSessionKey(sessionKey);
        } catch (err) {
            res.status(400).send(err.toString())
            return
        }
    }
     */
    
    try {
        const dialCode = body.dialCode;
        const phoneNumber = body.phoneNumber;
        switch (requestType) {
        case 'ping':
            res.status(200).send('pong');
            break;
        case 'sendSMS':
            if (!dialCode || !phoneNumber) {
                throw Error("Not all fields filled");
            }
            // Anti-Spam Measures
            if (await mongoHandler.authAbuseIsDetected(ip, dialCode, phoneNumber)) {
                res.status(420).send(JSON.stringify({ error: 'Rate limit', message: 'You are sending too many requests' }))
                return;
            }
            twilioClient.verify.services(process.env.VERIFY_ID)
                .verifications
                .create({ to: `+${dialCode}${phoneNumber}`, channel: 'sms' })
                .then(verification => console.log(verification.status));
            // Log event
            await mongoHandler.logSendSMS(
                ip,
                dialCode,
                phoneNumber
            );
            res.status(200).send();
            break;
        case 'checkCode':
            const code = body.code;
            if (code === undefined || !dialCode || !phoneNumber) {
                res.status(400).send("Missing params");
                return;
            }
            try {
                const verificationCheck = await twilioClient.verify.services(process.env.VERIFY_ID)
                    .verificationChecks
                    .create({
                        to: `+${dialCode}${phoneNumber}`,
                        code });
                console.log(verificationCheck);
                if (verificationCheck.status === 'approved') {
                } else {
                    res.status(400).send();
                    return;
                }
            } catch (error) {
                console.log(error);
                if (error.status === 404) {
                    // that code expired
                    res.status(404).send();
                }
                return;
            }
            console.log('done now can do other things');
            const referrerCode = body.referrerCode;
            // This is to check who referred the user, gives points
            // Check if user account exists
            const userExists = await mongoHandler.doesUserExist(dialCode, phoneNumber);
            console.log(userExists);
            // If user account doesn't exist, create user account and pass referrer Code
            if (!userExists) {
                await mongoHandler.createUser(dialCode, phoneNumber, referrerCode);
            }
            // create a session;
            const { sessionKey } = await mongoHandler.createSession(dialCode, phoneNumber, ip);
            res.status(200).send({ sessionKey });
            break;
        case 'checkSessionKey':
            await checkSessionKey(body, res);
            break;
        case 'likeTeam':
            await preCaller(body, res, likeTeam)
            break;
        case 'unlikeTeam':
            await preCaller(body, res, unlikeTeam)
            break;
        case 'getTeamAndEventLikes':
            await preCaller(body, res, getTeamAndEventLikes);
            break;
        case 'getTeamsForTeamList':
            await getTeamsForTeamList(body, res);
            break;
        case 'getAvatarsForTeams':
            await getAvatarsForTeams(body, res);
            break;
        default:
            res.status(400).send(`Unsupported requestType "${requestType}"`);
        }
    } catch (error) {
        console.error('Error while handling request: %o', error);
        res.status(500).send(`Error while handling request: ${error.message}`);
    }
}

async function checkSessionKey(body, res) {
    const sessionKey_string = body.sessionKey;
    if (sessionKey_string === undefined) {
        res.status(400).send("Missing params");
        return;
    }
    const { valid, dialCode, phoneNumber } = await mongoHandler.sessionKeyIsValid(sessionKey_string);
    if (valid) {
        const { gaveReward } = await mongoHandler.dailyLoginReward(dialCode, phoneNumber);
        res.status(200).send({ valid, gaveReward });
    } else {
        res.status(200).send({ valid })
    }
}

async function preCaller(body, res, async_callback) {
    const sessionKey_string = body.sessionKey;
    if (sessionKey_string === undefined) {
        res.status(400).send({"error_msg": "Missing session key"});
        return;
    }
    // check session key is valid
    const { valid, dialCode, phoneNumber } = await mongoHandler.sessionKeyIsValid(sessionKey_string);
    if (!valid) {
        res.status(403).send({"error_msg": "Invalid session key"});
        return;
    }
    await async_callback(body, res, dialCode, phoneNumber);
}

async function getTeamAndEventLikes(body, res, dialCode, phoneNumber) {
    const { teamLikes, eventLikes } = await mongoHandler.getTeamAndEventLikes(dialCode, phoneNumber);
    res.status(200).send({ teamLikes, eventLikes });
}

async function likeTeam(body, res, dialCode, phoneNumber) {
    const teamNumber_int = body.teamNumber;
    if (teamNumber_int === undefined) {
        res.status(400).send({"error_msg": "Missing params"});
        return;
    }
    await mongoHandler.likeTeam(dialCode, phoneNumber, teamNumber_int);
    const { teamLikes, eventLikes } = await mongoHandler.getTeamAndEventLikes(dialCode, phoneNumber);
    res.status(200).send({
        "success_msg": `You now like FRC team ${teamNumber_int}`,
        teamLikes,
        eventLikes
    });
}

async function unlikeTeam(body, res, dialCode, phoneNumber) {
    const teamNumber_int = body.teamNumber;
    if (teamNumber_int === undefined) {
        res.status(400).send({"error_msg": "Missing params"});
        return;
    }
    await mongoHandler.unlikeTeam(dialCode, phoneNumber, teamNumber_int);
    const { teamLikes, eventLikes } = await mongoHandler.getTeamAndEventLikes(dialCode, phoneNumber);
    res.status(200).send({
        "success_msg": `You no longer like FRC team ${teamNumber_int}`,
        teamLikes,
        eventLikes
    });
}

async function getTeamsForTeamList(body, res) {
    const teams = await mongoHandler.getTeamsForTeamList();
    res.status(200).send({
        teams
    })
}

async function getAvatarsForTeams(body, res) {
    const teams = body.list_of_team_number;
    if (teams === undefined) {
        res.status(400).send({"error_msg": "Missing params"})
    }
    const data = await mongoHandler.getAvatarsForTeams(teams);
    res.status(200).send(data);
}

app.post('/', handleRequest);
app.options('/', handleRequest);

app.listen(3001)
