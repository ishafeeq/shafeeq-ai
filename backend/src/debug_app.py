import chainlit as cl

@cl.on_chat_start
async def start():
    print("DEBUG: Minimal app started")
    await cl.Message(content="Hello! This is a minimal test.").send()

@cl.on_message
async def main(message: cl.Message):
    print(f"DEBUG: Echoing message: {message.content}")
    await cl.Message(content=f"Echo: {message.content}").send()
