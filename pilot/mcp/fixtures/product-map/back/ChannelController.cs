[Authorize(Policy = "Channels.Read")]
public class ChannelController {
  [HttpGet("read")] public void Read() {}
}
