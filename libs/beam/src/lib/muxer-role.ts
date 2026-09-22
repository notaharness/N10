/** Which side of a connection a Muxer is: 'initiator' dialled, 'acceptor'
 * accepted. Its own module so the stream-id allocator can name it without
 * importing the Muxer it is a part of. */
export type MuxerRole = 'initiator' | 'acceptor';
