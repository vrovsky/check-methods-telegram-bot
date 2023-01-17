const fs 	= require('fs')
const dotenv 	= require('dotenv').config()
const crypto 	= require('crypto')
const { Telegraf } = require('telegraf');
const bot       = new Telegraf(process.env.BOT_TOKEN,{handlerTimeout:100})
const nearApi 	= require('near-api-js')
const {parseContract} = require('wds-near-contract-parser')
const tMethods	= require('./methods.json')
const buffer	= {}, links = {}

getCode = async (accountId) => {
	const network = accountId.substr(-7)=='testnet' || (accountId.substr(-5)!='.near' && accountId.substr(0,3)=='dev')?'testnet':'mainnet'
	try{
		const provider = new nearApi.providers.JsonRpcProvider({url:'https://rpc.'+network+'.near.org'})
		return await provider.query({request_type:'view_code', account_id:accountId, finality:'final'})
	}catch(err) {
		console.log(err)
		return err
	}
}
createLink = (data) => {
	let key = 'link'+crypto.randomBytes(20).toString('hex')
	while (links[key]) key = 'link'+crypto.randomBytes(32).toString('base64')
	links[key] = data
	return key
}
showMethods = (contract,list) => {
	let text = ''
	for (const method of list){
		if (!tMethods[method]) text += '<code>'+method+'</code>\n' 
		else if (tMethods[method].type == 'call'){
			text += '<code>'+method+'</code>\n' 
		} else {
			if (tMethods[method].contract && tMethods[method].contract.indexOf(contract)<0) text += '<code>'+method+'</code>\n' 
			else text += '<a href="t.me/'+process.env.BOT_NAME+'?start='+createLink(Buffer.from(contract+';view;'+method+(tMethods[method].args?';'+JSON.stringify(tMethods[method].args):'')).toString('base64'))+'">'+method+'</a>\n' 
		}
	}
	return text
}
extractCode = async (ctx) => {
	const contract = ctx.match[1].toLowerCase()
	if (buffer[contract] && buffer[contract].time && Date.now()-buffer[contract].time < 3*60*1000) 
		return ctx.reply('<b><a href="t.me/'+process.env.BOT_NAME+'?start='+Buffer.from(contract).toString('base64')+'">'+contract+'</a></b> methods: <b>'+buffer[contract].list.length+'</b>\n'+showMethods(contract,buffer[contract].list),{parse_mode:'HTML',disable_web_page_preview:true, reply_markup:{inline_keyboard:[[{text:'Download Wasm File', callback_data:'download'}]]}})
	const mess = await ctx.reply(contract+' contract fetching ...') 
	const code = await getCode(contract)
	if (!code.code_base64) return ctx.telegram.editMessageText(ctx.from.id,mess.message_id,null,'contract fetch error')
	
	const xp = parseContract(code.code_base64)
	const list = xp && xp.methodNames
	if (!list.length){
		console.log('!!! contract methods not found')
		return ctx.telegram.editMessageText(ctx.from.id,mess.message_id,null,'<b>'+contract+'</b> methods not found. Try to view in hex editor',{parse_mode:'HTML',disable_web_page_preview:true, reply_markup:{inline_keyboard:[[{text:'Download Wasm File', callback_data:'download'}]]}})
	}	
	
	buffer[contract] = {list:list, time:Date.now()}
	let text = '<b><a href="t.me/'+process.env.BOT_NAME+'?start='+Buffer.from(contract).toString('base64')+'">'+contract+'</a></b> methods: <b>'+buffer[contract].list.length+'</b>\n'
	text += showMethods(contract,buffer[contract].list)
	if (text.length>4090){
		text = '<b>'+contract+'</b> methods: '+buffer[contract].list.length+'\n'+buffer[contract].list.map(e => e).join('\n')
		if (text.length>4090) text = text.substr(0,4090)+' ...'
	}
	return ctx.telegram.editMessageText(ctx.from.id,mess.message_id,null,text,{parse_mode:'HTML',disable_web_page_preview:true, reply_markup:{inline_keyboard:[[{text:'Download Wasm File', callback_data:'download'}]]}})
}
execMethod = async (ctx,params) => {
	const mess = await ctx.reply('executing ...')
	if (params[1] == 'call') return ctx.reply('call isnt workin aaaaaaaa')
	if (params[1] != 'view' || params.length<3) return ctx.reply('wrong payload data')
	if (params[3]){
		try{
			params[3] = JSON.parse(params[3])
		}catch(err){
			console.log(err)
			return ctx.reply('wrong method argument')
		}
	}
	const res = await viewMethod(params[0],params[2],params[3])
	if (res && !res.toString().startsWith('Error:') && params[1]==='view'){ 
		tMethods[params[2]] = {}
		if (params[3]) tMethods[params[2]].args = params[3]
	}
	let text = '<b><a href="t.me/'+process.env.BOT_NAME+'?start='+Buffer.from(params[0]).toString('base64')+'">'+params[0]+'</a></b>\n'
	text += '<a href="t.me/'+process.env.BOT_NAME+'?start='+createLink(Buffer.from(params[0]+';view;'+params[2]+(params[3]?';'+JSON.stringify(params[3]):'')).toString('base64'))+'">'+params[1]+' '+params[2]+(params[3]?' '+JSON.stringify(params[3]):'')+'</a>\n'
	text += 'result:\n'+showData(res)
	if (text.length>4090) text = text.substr(0,4090)+' ...'
	return ctx.telegram.editMessageText(ctx.from.id,mess.message_id,null,text,{parse_mode:'HTML',disable_web_page_preview:true})
}
viewMethod = async (contract, method, args={}) => {
	const network = contract.substr(-7)=='testnet' || (contract.substr(-5)!='.near' && contract.substr(0,3)=='dev')?'testnet':'mainnet'
	try{
		const provider = new nearApi.providers.JsonRpcProvider({url:'https://rpc.'+network+'.near.org'})
        const account = new nearApi.Account({provider:provider})
        return await account.viewFunction(contract,method,args)
	}catch(err) {
		return err.toString()
	}
}
showData = function(data){
	let text = typeof data=='string'?data:JSON.stringify(data,0,2)
	text = text.replace(/[\<\>]/g,'')
	text = text.replace(/"(data:image.+?)"\,/g,'"..."')
	if (text.length>4000) text.length = 4000
	return text
}

// BOT
bot.start(async ctx => {
	if (!ctx.startPayload) return ctx.reply('Send smart contract adress, mate.')
	if (ctx.startPayload.startsWith('link')){
		if (!links[ctx.startPayload]) return ctx.reply('No link data found. Gotta recheck yourself, man.')
		ctx.startPayload = links[ctx.startPayload]
	}
	const params = Buffer.from(ctx.startPayload,'base64').toString().split(';')
	if (params.length == 1){
		ctx.match = ['',params[0]]
		return extractCode(ctx)
	}
	return execMethod(ctx,params)
})
bot.hears(/^([a-z0-9\.\-\_]+?\.(near|testnet))$/i, ctx => extractCode(ctx))
bot.hears(/^\@(\S+)$/i, ctx => extractCode(ctx))
bot.hears(/^(dev\-\S+)/i, ctx => extractCode(ctx))
bot.hears(/^([0-9a-f]{64})$/i, ctx => extractCode(ctx))
bot.command('methods', async (ctx,next) => {
	return ctx.replyWithDocument({source:Buffer.from(JSON.stringify(tMethods,0,2)),filename:'methods.json'},{caption:'methods: '+Object.keys(tMethods).length}) 
})
bot.action('download', async ctx => {
	const contract = /^(\S+?)\smethods/.exec(ctx.callbackQuery.message.text)
	if (!contract) return ctx.answerCbQuery('NEAR address not found')
	const code = await getCode(contract[1])
	if (!code.code_base64) return ctx.answerCbQuery('contract fetch error',true)
	try{
		await ctx.replyWithDocument({source:Buffer.from(code.code_base64,'base64'),filename:contract[1]+'.wasm'},{caption:code.hash}) 
	}catch(err){return ctx.answerCbQuery('file download error',true)}
	return ctx.answerCbQuery()
})
bot.on('text', async (ctx,next) => {
	const contract = /^(\S+?)\smethods\:\s*\d+\s*(.+)/.exec(ctx.message.reply_to_message && ctx.message.reply_to_message.text.replace(/\n/g,' '))
	const methods = contract && contract[2] && contract[2].split(' ')
	const params = /^\s*(view|call)\s+(\S+)\s*(.+)*$/.exec(ctx.message.text)
	if (!contract || !params) return next()
	if (!methods || methods.indexOf(params[2])<0) return ctx.reply('Method not found')
	params[0] = contract[1]
	return execMethod(ctx,params)
})
bot.on('message', ctx => ctx.reply('Unrecognized command'))
bot.catch(err => console.error(err))
bot.launch({polling:{timeout:60}})
bot.telegram.getMe().then(res => process.env.BOT_NAME = process.env.BOT_NAME || (res && res.username))