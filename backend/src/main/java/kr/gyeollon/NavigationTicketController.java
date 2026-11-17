package kr.gyeollon;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
@RestController
public class NavigationTicketController {
    @org.springframework.beans.factory.annotation.Autowired private DynamicApiProxy dynamic;
    @org.springframework.beans.factory.annotation.Autowired private com.fasterxml.jackson.databind.ObjectMapper mapper;
    private final NavigationTickets tickets;
    public NavigationTicketController(NavigationTickets tickets){this.tickets=tickets;}
    record Request(String ticket) {}
    @PostMapping("/api/navigation/resolve")
    public ResponseEntity<?> resolve(@RequestBody Request request) {
        if(dynamic.configured())return dynamic.post("/api/navigation/resolve",mapper.valueToTree(request));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer").body(tickets.resolve(request.ticket()));
    }
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Void> invalid(){return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).build();}
}
