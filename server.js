// server.js
// where your node app starts

// init project
const express = require('express');
const app = express();
const fetch = require("node-fetch")
const request = require("request")
const fs = require("fs");

//create required directories
["./tmp"].forEach(async dir => {
    fs.existsSync(dir) || fs.mkdirSync(dir);
});

const getDate = () => {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '')
};

const getHour = () => {
    return `${getDate()}${new Date().toISOString().split("T")[1].slice(0, 2)}`;
}

const quotaDaily = 200;
let quotaCurrent = 0;

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
});

app.get('/daily', async (req, res) => {
    res.json(await getCDNfiles());
});

const getCDNfiles = () => new Promise((resolve, reject) => {
    console.log(`⏳[FTP] getting songs...`)
    var Client = require('ftp');
    var options = {
        host: process.env.FTP_HOST,
        port: 21,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASS_RO
    };
    var c = new Client();
    //on client ready, upload the file.
    c.on('ready', () => {

        c.cwd(getDate(), (err, list) => {
            if (err) return reject(err);
            c.listSafe((err, list) => {
                if (err) return reject(err);

                console.log(`⏳[FTP-query] Listing songs...`)

                var files = [];
                for (const i in list) {
                    const entry = `https://${process.env.CDN}/${getDate()}/${list[i].name}`;
                    files.push(entry)
                }
                resolve(files);
            });
            c.end(); //end client
        });
    });
    //general error
    c.on('error', (err) => {
        return reject(err);
    });
    c.connect(options);
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function() {
    console.log('Your app is listening on port ' + listener.address().port);
});

const get = async (song) => new Promise((resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/play`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }).on('response', async file => {

        console.log(`⏳[TMP] Writing °${song.name}° to disk...`);

        const fname = Buffer.from(song.name).toString('base64')
        var stream = file.pipe(fs.createWriteStream(`tmp/${fname}.mp3`));

        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("finish", async () => {
            console.log(`✔️[TMP] Written °${song.name}° to disk.`);
            //upload file from tmp to ftp
            await upload({
                host: process.env.FTP_HOST,
                port: 21,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASS,
            }, `tmp/${fname}.mp3`, `${getDate()}/${fname}.mp3`);
            resolve();
        });
    })
});


//************ FTP custom (requires 'ftp')
const upload = async (credentials, pathToLocalFile, pathToRemoteFile) => new Promise((resolve, reject) => {
    var Client = require('ftp');
    var options = {
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password
    };
    var c = new Client();
    //on client ready, upload the file.
    c.on('ready', () => {
        console.log(`⏳[FTP] Upload of °${pathToLocalFile}° started...`)
        c.put(pathToLocalFile, pathToRemoteFile, function(err) {

            c.cwd(getDate(), (err, list) => {
                if (err) return reject(err);
                //update quota variable, based on actual daily processed items
                c.listSafe((err, list) => {
                    if (err) return reject(err);
                    quotaCurrent = list.length;
                    console.log(list.length)
                });

                c.end(); //end client
            });
            fs.unlink(pathToLocalFile, (error) => {
                /* handle error */
            });
            console.log(`✔️[FTP] Upload to ftp completed: °${pathToLocalFile}° => °${pathToRemoteFile}°.`)
            if (err) reject(err); //reject promise
            resolve(); //fullfill promise
        });
    });
    //general error
    c.on('error', (err) => {
        return reject(err);
    });
    c.connect(options);
});

const refreshQuota = async () => new Promise((resolve, reject) => {
    console.log(`⏳[FTP] Starting quota refreshing...`);
    var Client = require('ftp');
    var options = {
        host: process.env.FTP_HOST,
        port: 21,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASS_RO,
    };
    var c = new Client();
    //on client ready, upload the file.
    c.on('ready', () => {
        console.log(`⏳[FTP] Getting quota by ftp...`);

        c.cwd(getDate(), (err, list) => {
            if (err) return reject(err);
            //update quota variable, based on actual daily processed items
            c.listSafe((err, list) => {
                if (err) return reject(err);
                quotaCurrent = list.length;
                console.log(`✔️[FTP] Quota updated: ${quotaCurrent}.`);
                resolve();
            });

            c.end(); //end client
        });
    });
    c.connect(options);
});

//Delete a song object frtom the AI server
const deleteSong = (song => new Promise(async (resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/delete`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }, (error, response, result) => {

        if (error === null) {
            console.log(`✔️[AI] °${song.name}° was deleted on generating server.`);
            resolve();
        } else {
            console.error(error);
            return reject(error);
        }
    });
}));

//Create a new Song on AI server
const create = () => new Promise(async (resolve, reject) => {
    if (quotaCurrent < quotaDaily)
        request({
            url: `https://${process.env.HOST}/composition/original/createFromPreset`,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'Authorization': process.env.TOKEN
            },
            json: {
                duration: "auto",
                ensemble: "auto",
                folderID: "",
                includeDrums: true,
                includeTempoMap: true,
                key: "auto",
                numberOfCompositions: "1",
                pacing: "auto",
                preset: "fantasy",
                timeSignature: "auto",
                token: process.env.TOKEN
            }
        }, (error, response, body) => {
            if (error === null) {
                const song = body.compositions[0];
                console.log(`⏳[AI] #${song._id} (${song.name}) is getting created...`);
                resolve();
            } else {
                console.error(`⚠️[WARNING] ${error}`);
                return reject(error);
            }
        });
    else {
        console.log("⚠️[WARNING] Daily quota reached.");
        setTimeout(() => {
            // quota.reset();
        }, 1000 * 60 * (60));
    }
});

//Process songs on AI Server
const pumpSongs = () => {
    console.log(`ℹ️[PUMPER] Refreshing state... [Creation Quota: ${quotaCurrent}/${quotaDaily} for day ${getDate()}]`)
    //get songs
    request({
        url: `https://${process.env.HOST}/folder/getContent`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            folderID: "",
            getSharedContent: false,
            token: process.env.TOKEN
        }
    }, async (error, res, json) => {
        console.log("⏳[PUMPER] Processing songs...")
        //if songs have been generated already
        if (json.compositions && json.compositions.length > 0) {
            //loop over songs
            for (var key in json.compositions) {
                const song = json.compositions[key];
                console.log(`⏳[AI] Checking if °${song.name}° can be processed...`)
                //song done generating
                if (song.isFinished) { //done
                    console.log(`⏳[AI] getting °${song.name}°...`)
                    await get(song);
                    console.log(`⏳[AI] deleting °${song.name}°...`)
                    await deleteSong(song);
                }
            }
        } else await create(); //create new if not existing
        setTimeout(pumpSongs, 31999);
    });
};

//let's go
[(async () => {
    await refreshQuota();
    setTimeout(pumpSongs, 9999);
})()];