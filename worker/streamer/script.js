export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const trackId = url.searchParams.get("id");

    if (!trackId) {
      return new Response("Missing track ID", { status: 400 });
    }

    try {
      // 1. Run DB commands in a batch
      const [updateResult, trackData] = await env.DB.batch([
        env.DB.prepare("UPDATE track SET plays = plays + 1 WHERE id = ?").bind(trackId),
        env.DB.prepare(`
          SELECT album.folder_path, track.mp3 
          FROM album 
          JOIN track ON track.album_id = album.id 
          WHERE track.id = ?
        `).bind(trackId)
      ]);

      const track = trackData.results[0];

      if (!track) {
        return new Response("Track not found", { status: 404 });
      }

      // 2. Construct the object path
      // Resulting path: folder_path/mp3
      const objectPath = `music/${track.folder_path}/${track.mp3}`;

      // 3. Fetch from R2
      const object = await env.BUCKET.get(objectPath);

      if (object === null) {
        return new Response("Object Not Found in R2", { status: 404 });
      }

      // 4. Stream the audio
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Content-Type", "audio/mpeg"); // Force audio type

      return new Response(object.body, {
        headers,
      });

    } catch (e) {
      return new Response(e.message, { status: 500 });
    }
  },
};